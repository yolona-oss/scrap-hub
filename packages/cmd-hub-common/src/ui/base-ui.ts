import { WithInit } from '../types/with-init'
import type { IUI, ILockManagerLike, MessageOptions } from './types'
import type { BaseUIContext } from './context'
import type { IUIPlugin } from './plugin'
import type { IMarkupOption } from './markup'

/**
 * Common framework base for UI implementations. Generic in the dispatcher type
 * so @cmd-hub/common doesn't pull in cmd-hub's CmdDispatcher. Concrete UI packages
 * (e.g. @cmd-hub/ui-telegram) substitute their CmdDispatcher<Ctx> for the
 * Dispatcher parameter and hand a concrete instance to the constructor /
 * abstract field.
 *
 * MessageLifecycleManager wiring lives in cmd-hub's sister subclass because the
 * lifecycle manager depends on the mongoose-backed PendingDelete model. This
 * common base intentionally OMITS the `.lifecycle` field; cmd-hub's adapter
 * adds it as `@core/ui/base-ui` extends this class.
 */
export abstract class BaseUI<CtxType extends BaseUIContext, Dispatcher = unknown>
    extends WithInit
    implements IUI<CtxType, Dispatcher>
{
    abstract readonly dispatcher: Dispatcher

    protected plugins: IUIPlugin<CtxType>[] = []

    use(plugin: IUIPlugin<CtxType>): this {
        this.plugins.push(plugin)
        return this
    }

    getPlugins(): ReadonlyArray<IUIPlugin<CtxType>> {
        return this.plugins
    }

    getPlugin<T extends IUIPlugin<CtxType>>(name: string): T | undefined {
        return this.plugins.find(p => p.name === name) as T | undefined
    }

    // Message operations with plugin hooks

    async sendMessage(user_id: string, message: string, markup?: IMarkupOption[], options?: MessageOptions): Promise<string> {
        let msg = message
        let mk = markup

        for (const p of this.plugins) {
            if (p.onBeforeSendMessage) {
                const result = await p.onBeforeSendMessage(user_id, msg, mk)
                if (result) {
                    msg = result.message
                    mk = result.markup ?? mk
                }
            }
        }

        const messageId = await this.sendMessageImpl(user_id, msg, mk, options)

        for (const p of this.plugins) {
            if (p.onAfterSendMessage) {
                await p.onAfterSendMessage(user_id, messageId)
            }
        }

        return messageId
    }

    async editMessage(user_id: string, message_id: string, message?: string, markup?: IMarkupOption[], options?: MessageOptions): Promise<void> {
        let msg = message
        let mk = markup

        for (const p of this.plugins) {
            if (p.onBeforeEditMessage) {
                const result = await p.onBeforeEditMessage(user_id, message_id, msg, mk)
                if (result) {
                    msg = result.message ?? msg
                    mk = result.markup ?? mk
                }
            }
        }

        await this.editMessageImpl(user_id, message_id, msg, mk, options)
    }

    async deleteMessage(user_id: string, message_id: string): Promise<void> {
        for (const p of this.plugins) {
            if (p.onBeforeDeleteMessage) {
                const allowed = await p.onBeforeDeleteMessage(user_id, message_id)
                if (!allowed) return
            }
        }

        await this.deleteMessageImpl(user_id, message_id)
    }

    // Plugin lifecycle hooks

    protected async initPlugins(): Promise<void> {
        for (const p of this.plugins) {
            if (p.onInit) {
                await p.onInit(this)
            }
        }
    }

    protected async terminatePlugins(): Promise<void> {
        for (const p of this.plugins) {
            if (p.onTerminate) {
                await p.onTerminate(this)
            }
        }
    }

    // Subclasses implement platform-specific operations
    protected abstract sendMessageImpl(user_id: string, message: string, markup?: IMarkupOption[], options?: MessageOptions): Promise<string>
    protected abstract editMessageImpl(user_id: string, message_id: string, message?: string, markup?: IMarkupOption[], options?: MessageOptions): Promise<void>
    protected abstract deleteMessageImpl(user_id: string, message_id: string): Promise<void>

    // IUI members that subclasses must implement
    abstract max_message_width(): number
    abstract ContextType(): string
    abstract consolePrintCommands(): void
    abstract lock(lockManager: ILockManagerLike): boolean
    abstract unlock(lockManager: ILockManagerLike): boolean
    abstract isRunning(): boolean
    abstract run(): Promise<void>
    abstract terminate(): Promise<void>
}
