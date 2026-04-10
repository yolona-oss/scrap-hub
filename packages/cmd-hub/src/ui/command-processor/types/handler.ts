import { BaseUIContext, IUICommand } from "@core/ui"
import { IvokeableType, IUI_InvokableCommand } from "@core/ui/types/command"
import { IBaseMarkup } from "./markup"
import { MessageType } from "@core/ui/message-lifecycle"

export interface IUICommandEntry<Ctx extends BaseUIContext> extends Omit<IUI_InvokableCommand<Ctx>, 'command'> {
    seqBounded: boolean
}

export interface IHandleResult {
    success: boolean
    markup: IBaseMarkup
    messageType?: MessageType
}

export interface ICmdRegisterEntry<Ctx extends BaseUIContext> {
    command: IUICommand,
    invokable: IvokeableType<Ctx>
}
export type ICmdRegisterManyEntry<Ctx extends BaseUIContext> = Array<ICmdRegisterEntry<Ctx>>
