import { anyToString } from "@cmd-hub/common"
import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "../../../ui"

import log from '../../../application/logger';

export class HandleSequenceCommand<Ctx extends BaseUIContext> extends AbstractCmdHandler<Ctx> {
    public async handle(request: ICmdHandlerRequest<Ctx>): Promise<ICmdHandlerResponce> {
        const { command, userId, dispatcher } = request

        // Sequence handling only applies to LOCAL invokables (built-ins
        // chained via /next, /back, /cancel). Remote commands aren't part
        // of any sequence — pass them through to the invocation handler.
        const cb = dispatcher.tryGetInvokable(command)
        if (!cb || !cb.seqBounded) {
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
