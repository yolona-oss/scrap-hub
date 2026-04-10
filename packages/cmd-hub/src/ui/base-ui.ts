import { WithInit } from "@core/types/with-init"
import { IUI } from "./types/ui"
import { BaseUIContext } from "./types/context"
import { IUIPlugin } from "./types/plugin"
import { IMarkupOption } from "./command-processor/types/markup"
import { MessageOptions } from "./types/ui"
import { CmdDispatcher } from "./command-processor"
import { LockManager } from "@utils/lock-manager"
import { AvailableUIsType } from "./impls"
import { MessageLifecycleManager, MessageType } from "./message-lifecycle"

export abstract class BaseUI<CtxType extends BaseUIContext> extends WithInit implements IUI<CtxType> {
    abstract readonly dispatcher: CmdDispatcher<CtxType>

    protected plugins: IUIPlugin<CtxType>[] = []
    public readonly lifecycle: MessageLifecycleManager<CtxType> = new MessageLifecycleManager(this as any)

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
    abstract ContextType(): AvailableUIsType
    abstract consolePrintCommands(): void
    abstract lock(lockManager: LockManager): boolean
    abstract unlock(lockManager: LockManager): boolean
    abstract isRunning(): boolean
    abstract run(): Promise<void>
    abstract terminate(): Promise<void>
}
