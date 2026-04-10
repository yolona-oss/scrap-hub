import { BaseUIContext } from "@core/ui"
import { ICmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./types"
//import log from "@core/application/logger"

export * from './types'

export abstract class AbstractCmdHandler<Ctx extends BaseUIContext> implements ICmdHandler<Ctx> {
    private next: ICmdHandler<Ctx> | null = null

    constructor() { }

    setNext(next: ICmdHandler<Ctx>) {
        this.next = next
        return next
    }

    async handle(request: ICmdHandlerRequest<Ctx>): Promise<ICmdHandlerResponce> {
        if (this.next) {
            //log.trace(this.next.constructor.name)
            return await this.next.handle(request)
        }

        //log.trace("-- CmdHandler chain end --")
        return { success: false, markup: {text: "No handler"} }
    }
}
