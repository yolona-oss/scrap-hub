import type { IRunnable } from '../types/runnable'
import type { IWithInit } from '../types/with-init'
import type { BaseUIContext } from './context'
import type { IMarkupOption } from './markup'

export interface MessageOptions {
    parseMode?: 'HTML' | 'MarkdownV2'
}

/**
 * Minimal lock-manager contract (BaseUI.lock/unlock). The concrete LockManager
 * lives in cmd-hub. Kept here so @cmd-hub/common's UI contracts do not depend on
 * cmd-hub utilities.
 */
export interface ILockManagerLike {
    createLockFile(hash: string, data?: string): string | null
    deleteLockFile(fileName: string): boolean
}

/**
 * Generic UI interface. `Dispatcher` is typed `unknown` by default so
 * @cmd-hub/common doesn't know about CmdDispatcher. Consumer packages re-declare
 * a narrowed alias (cmd-hub's `ui/types/ui.ts` sets `Dispatcher = CmdDispatcher<Ctx>`).
 */
export interface IUI<CtxType extends BaseUIContext = BaseUIContext, Dispatcher = unknown>
    extends IRunnable, IWithInit
{
    readonly dispatcher: Dispatcher

    /** Phantom binding for `CtxType` so `IUI<A>` and `IUI<B>` stay structurally
     *  distinct — without a reference to CtxType somewhere in the shape, TS
     *  would erase the generic and treat both as the same type. */
    readonly _ctxType?: CtxType

    /**
     * @returns message_id of sent message
     */
    sendMessage(user_id: string, message: string, markup?: IMarkupOption[], options?: MessageOptions): Promise<string>
    editMessage(user_id: string, message_id: string, message?: string, markup?: IMarkupOption[], options?: MessageOptions): Promise<void>
    deleteMessage(user_id: string, message_id: string): Promise<void>

    max_message_width(): number

    /** Short identity tag returned by the concrete UI (e.g. `"telegram"`,
     *  `"cli"`, `"web"`). No registry enforcement — UIs pick their own tag. */
    ContextType(): string

    consolePrintCommands(): void

    lock(lockManager: ILockManagerLike): boolean
    unlock(lockManager: ILockManagerLike): boolean

    terminate(): Promise<void>
}
