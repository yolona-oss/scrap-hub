import { BaseUIContext } from "./context"
import { IUI } from "./ui"
import { IHandleResult } from "../command-processor/types"
import { IMarkupOption } from "../command-processor/types/markup"
import { AbstractCmdHandler } from "../command-processor/handlers/abstract-handler"

export interface IUIPlugin<CtxType extends BaseUIContext = BaseUIContext> {
    readonly name: string

    // Lifecycle
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
    commandHandlers?(): AbstractCmdHandler<CtxType>[]
}
