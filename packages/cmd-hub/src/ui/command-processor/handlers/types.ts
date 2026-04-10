import { CmdDispatcher } from "../dispatcher"
import { Chain, IChainHandler } from "@core/utils/chain"
import { IHandleResult } from "../types"
import { BaseUIContext, IUI } from "@core/ui"

export type ICmdHandlerResponce = IHandleResult
export interface ICmdHandlerRequest<Ctx extends BaseUIContext> {
    dispatcher: CmdDispatcher<Ctx>,
    text: string,
    command: string,
    uiCtx: Ctx,
    uiImpl: IUI<Ctx>,
    userId: string,
    ownerId: string,
    words: string[]
}
export type ICmdHandler<Ctx extends BaseUIContext> = IChainHandler<ICmdHandlerRequest<Ctx>, Promise<ICmdHandlerResponce>>
export type ICommandHandlerChain<Ctx extends BaseUIContext> = Chain<ICmdHandlerRequest<Ctx>, Promise<ICmdHandlerResponce>>
