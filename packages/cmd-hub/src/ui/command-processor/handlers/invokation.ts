import log from '@logger';
import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "@core/ui"
import { anyToString } from "@core/utils/misc"
import { UiUnicodeSymbols } from "@core/ui"

export class HandleInvokation<Ctx extends BaseUIContext> extends AbstractCmdHandler<Ctx> {

    public async handle(request: ICmdHandlerRequest<Ctx>): Promise<ICmdHandlerResponce> {
        const { command, uiCtx, userId, words: args, dispatcher, uiImpl } = request

        let res: ICmdHandlerResponce|undefined
        try {
            const compiled = await dispatcher.CommandBuilder.compile(userId, command, args.join(' '), uiCtx, dispatcher)
            const invoker = dispatcher.RemoteInvoker
            if (!invoker) {
                return {
                    success: false,
                    markup: {
                        text: `${UiUnicodeSymbols.error} No remote invoker attached to dispatcher`,
                    },
                }
            }
            res = await invoker.invokeLegacy(userId, compiled.Result, uiCtx, uiImpl as any)
        } catch (e: any) {
            log.error("Command execution error: " + anyToString(e))
            return {
                success: false,
                markup: {
                    text: `${UiUnicodeSymbols.error} Command ${UiUnicodeSymbols.arrowRight} "${command}" execution error:\n -- ${anyToString(e) || UiUnicodeSymbols.warning  + " unknown error"}`
                }
            }
        }

        if (res?.success) {
            return res
        } else {
            uiCtx.reply(`${UiUnicodeSymbols.error} Command ${UiUnicodeSymbols.arrowRight} "${command}" failed:\n -- ${UiUnicodeSymbols.warning} ${res?.markup?.text ?? UiUnicodeSymbols.warning  + " unknown error"}`)
        }

        return await super.handle(request)
    }
}
