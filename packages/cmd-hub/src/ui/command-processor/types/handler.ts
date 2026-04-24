import { BaseUIContext, IUICommand } from "../../../ui"
import { IvokeableType, IUI_InvokableCommand } from "../../../ui/types/command"
export type { IHandleResult } from '@cmd-hub/common'

export interface IUICommandEntry<Ctx extends BaseUIContext> extends Omit<IUI_InvokableCommand<Ctx>, 'command'> {
    seqBounded: boolean
}

export interface ICmdRegisterEntry<Ctx extends BaseUIContext> {
    command: IUICommand,
    invokable: IvokeableType<Ctx>
}
export type ICmdRegisterManyEntry<Ctx extends BaseUIContext> = Array<ICmdRegisterEntry<Ctx>>
