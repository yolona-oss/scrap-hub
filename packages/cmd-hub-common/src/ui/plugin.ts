import type { BaseUIContext } from './context'
import type { IUI } from './types'
import type { IMarkupOption } from './markup'
import type { IHandleResult } from './handle-result'

/**
 * UI plugin interceptor contract. Generic in the handler type so @cmd-hub/common
 * stays decoupled from cmd-hub's concrete handler chain.
 */
export interface IUIPlugin<
    CtxType extends BaseUIContext = BaseUIContext,
    HandlerT = unknown,
    DispatcherT = unknown,
> {
    readonly name: string

    // Lifecycle
    /** Fires while the dispatcher is still mutable (BEFORE `dispatcher.done()`).
     *  Use this to register additional commands that any UI gets for free. */
    onDispatcherSetup?(dispatcher: DispatcherT, ui: IUI<CtxType>): Promise<void> | void
    onInit?(ui: IUI<CtxType>): Promise<void>
    onTerminate?(ui: IUI<CtxType>): Promise<void>

    // Message interceptors (return modified content or void to pass through)
    onBeforeSendMessage?(userId: string, message: string, markup?: IMarkupOption[]): Promise<{ message: string; markup?: IMarkupOption[] } | void>
    onAfterSendMessage?(userId: string, messageId: string): Promise<void>
    onBeforeEditMessage?(userId: string, messageId: string, message?: string, markup?: IMarkupOption[]): Promise<{ message?: string; markup?: IMarkupOption[] } | void>
    onBeforeDeleteMessage?(userId: string, messageId: string): Promise<boolean>

    // Command interceptors
    onBeforeCommand?(command: string, userText: string, ctx: CtxType): Promise<boolean>
    onAfterCommand?(command: string, result: IHandleResult, ctx: CtxType): Promise<IHandleResult>

    // Handler chain extension
    /** TODO: not yet wired into BaseUI's plugin loop. Declared so plugins can
     *  contribute additional command handlers when the chain is taught to
     *  consume them; until then, a returned array is silently ignored. */
    commandHandlers?(): HandlerT[]
}
