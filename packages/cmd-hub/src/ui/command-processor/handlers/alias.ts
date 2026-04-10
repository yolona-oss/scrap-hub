import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "@core/ui"
import { anyToString } from "@core/utils/misc"
import { UiUnicodeSymbols } from "@core/ui"
import log from '@logger';
import { CmdAlias } from "@core/db"

export class HandleCommandAlias<Ctx extends BaseUIContext> extends AbstractCmdHandler<Ctx> {

    public async handle(request: ICmdHandlerRequest<Ctx>): Promise<ICmdHandlerResponce> {
        const { command, dispatcher, uiCtx, uiImpl, ownerId } = request

        const aliasDoc = await CmdAlias.findOne({owner_id: ownerId, alias: command})
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
            return await dispatcher.CommandInvoker.invoke(request.userId, compiled.Result, uiCtx, uiImpl)
        } catch (e: any) {
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
