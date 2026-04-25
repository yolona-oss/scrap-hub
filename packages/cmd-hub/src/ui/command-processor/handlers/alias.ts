import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "../../../ui"
import { anyToString } from "../../../utils/misc"
import { UiUnicodeSymbols } from "../../../ui"
import log from '../../../application/logger'

export class HandleCommandAlias<Ctx extends BaseUIContext> extends AbstractCmdHandler<Ctx> {

    public async handle(request: ICmdHandlerRequest<Ctx>): Promise<ICmdHandlerResponce> {
        const { command, dispatcher, uiCtx, uiImpl, ownerId } = request

        const repos = dispatcher.repos
        if (!repos) return super.handle(request)

        const aliasDoc = await repos.cmdAlias.findByOwnerAndAlias(ownerId, command)
        if (!aliasDoc) {
            return super.handle(request)
        }

        const commandStr = aliasDoc.command
        const commandSplit = commandStr.split(" ")
        const commandName = commandSplit[0]
        const commandArg = commandSplit.slice(1).join(" ")
        if (!dispatcher.isCommandRegistered(commandName)) {
            return {
                success: false,
                markup: {
                    text: `Aliased(${aliasDoc.alias}) command "${commandName}" is not registered.`
                }
            }
        }
        try {
            const compiled = await dispatcher.CommandBuilder.compile(request.userId, commandName, commandArg, uiCtx, dispatcher)
            const invoker = dispatcher.RemoteInvoker
            if (!invoker) {
                return {
                    success: false,
                    markup: {
                        text: `${UiUnicodeSymbols.error} No remote invoker attached to dispatcher`,
                    },
                }
            }
            return await invoker.invokeLegacy(request.userId, compiled.Result, uiCtx, uiImpl)
        } catch (e: unknown) {
            log.error("Command execution error: " + anyToString(e))
            return {
                success: false,
                markup: {
                    text: `${UiUnicodeSymbols.error} Command ${UiUnicodeSymbols.arrowRight} "${command}" execution error:\n -- ${anyToString(e) || UiUnicodeSymbols.warning  + " unknown error"}`
                }
            }
        }
    }
}
