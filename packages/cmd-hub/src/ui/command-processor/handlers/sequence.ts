import { anyToString } from "@core/utils/misc"
import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "@core/ui"

import log from '@logger';

export class HandleSequenceCommand<Ctx extends BaseUIContext> extends AbstractCmdHandler<Ctx> {
    public async handle(request: ICmdHandlerRequest<Ctx>): Promise<ICmdHandlerResponce> {
        const { command, userId, dispatcher } = request

        const cb = dispatcher.getInvokable(command)
        if (!cb.seqBounded) {
            return await super.handle(request)
        }

        let res
        let err
        const sequenceHandler = dispatcher.SequenceHandler
        try {
            res = sequenceHandler.handle(userId, command)
        } catch (e: any) {
            err = anyToString(e)
            log.error(`Sequence handling error: ` + err)
        }
        if (err && err.length > 0) {
            return {
                success: false,
                markup: {
                    text: err
                }
            }
        }

        if (res) {
            return res
        }

        return await super.handle(request)
    }
}
