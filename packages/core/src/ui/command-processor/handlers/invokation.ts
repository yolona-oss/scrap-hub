import log from '../../../application/logger';
import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "../../../ui"
import { anyToString } from "@cmd-hub/common"
import { UiUnicodeSymbols } from "../../../ui"
import { isOneShot, formatEffectiveArgs } from "../../types/command"

export class HandleInvokation<Ctx extends BaseUIContext> extends AbstractCmdHandler<Ctx> {

    public async handle(request: ICmdHandlerRequest<Ctx>): Promise<ICmdHandlerResponce> {
        const { command, uiCtx, userId, words: args, dispatcher, uiImpl } = request

        // Two-tier dispatch:
        //  1. If `command` is in the dispatcher's local registry (built-ins
        //     like /help, /alias, /sconfig, /invite, plus any command added
        //     via `dispatcher.register()`), compile against the local
        //     descriptor and call its invokable in-process.
        //  2. Otherwise route to a cmd-node via RemoteCmdInvoker, using
        //     the same descriptor-compile path so the builder UX feels
        //     identical for local and remote commands.
        // Both branches go through `CommandBuilder.compile()` — the
        // descriptor compiler picks local vs. remote based on which side
        // of the dispatcher knows the command.
        let res: ICmdHandlerResponce|undefined
        try {
            const compiled = await dispatcher.CommandBuilder.compile(userId, command, args.join(' '), uiCtx, dispatcher)
            const localEntry = dispatcher.tryGetInvokable(command)

            log.info(`exec: ${formatEffectiveArgs(compiled.Result)}`)

            if (localEntry) {
                if (isOneShot(localEntry.invokable)) {
                    await localEntry.invokable.call(dispatcher, compiled.Result.proxy, uiCtx, uiImpl)
                    return {
                        success: true,
                        markup: { text: '' },
                        messageType: 'system',
                    }
                }
                // Local service: fall through to RemoteCmdInvoker which
                // handles long-running BaseCommandService-shaped invokables.
            }

            const invoker = dispatcher.RemoteInvoker
            if (!invoker) {
                return {
                    success: false,
                    markup: {
                        text: `${UiUnicodeSymbols.error} No remote invoker attached to dispatcher`,
                    },
                }
            }
            res = await invoker.invokeLegacy(userId, compiled.Result, uiCtx, uiImpl, dispatcher)
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
