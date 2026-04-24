import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler";
import { BaseUIContext } from "@core/ui/types";
import { BaseUI } from "@core/ui/base-ui";
import { CommandBuilder } from "../builder";
import { CmdDispatcher } from "../dispatcher";
import log from '@logger';
import { CBDescriptorCompiler } from "../builder/desc-compiler";
import { IUICommandDescriptor } from "@core/ui/types";
import { Account, Manager } from "@core/db";

// TODO add completion for builtin commands

export class HandleCmdBuilder<UICtx extends BaseUIContext> extends AbstractCmdHandler<UICtx> {

    private async startNewBuild(userId: string, command: string, args: string[], ctx: UICtx, builder: CommandBuilder, dispatcher: CmdDispatcher<UICtx>): Promise<ICmdHandlerResponce|void> {
        log.trace(`Checking for availability to start build: ${command}`)
        log.trace(`Command: ${command}\nArgs: ${args}`)
        if (!dispatcher.isAllArgsPassed(command, args)) {
            const avalibleCtxs = CommandBuilder.selectReadingContexts(command, userId, dispatcher)

            const descCompiler = new CBDescriptorCompiler<UICtx>()
            let desc: IUICommandDescriptor = await descCompiler.compile(
                command,
                userId,
                dispatcher,
                ctx
            )

            // Fetch saved data for services to show in builder
            let savedData: Record<string, any> | undefined
            if (dispatcher.isService(command)) {
                try {
                    const owner = await Manager.findOne({ userId: ctx.manager?.userId })
                    if (owner) {
                        const account = await Account.findById(owner.account)
                        if (account) {
                            const { account_module } = await account.getModuleByNameOrCreate(command)
                            savedData = account_module.data?.config
                        }
                    }
                } catch (_) {}
            }

            const res = builder.startBuild(userId, command, desc, avalibleCtxs, undefined, savedData)

            return {
                success: true,
                markup: res,
                messageType: 'builder' as const
            }
        }
        return
    }

    private async handleBuildProcess(userId: string, text: string, ctx: UICtx, builder: CommandBuilder, dispatcher: CmdDispatcher<UICtx>, uiImpl: any): Promise<ICmdHandlerResponce|void> {
        if (builder.isUserOnBuild(userId)) {
            const stepRes = builder.handle(userId, text)

            if (stepRes.IsCompiled) {
                log.trace(`Build done: invoking command: ${stepRes.Result.command}`)
                // Build complete — schedule cleanup of all builder messages
                if (uiImpl instanceof BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000)
                }
                const invoker = dispatcher.RemoteInvoker
                if (!invoker) {
                    return {
                        success: false,
                        markup: { text: 'No remote invoker attached to dispatcher' },
                        messageType: 'system' as const,
                    }
                }
                return await invoker.invokeLegacy(userId, stepRes.Result, ctx, uiImpl as any)
            }

            if (stepRes.Done) {
                // Build cancelled — schedule cleanup of all builder messages
                if (uiImpl instanceof BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000)
                }
            }

            return {
                success: !Boolean(stepRes),
                markup: stepRes.Markup,
                messageType: 'builder' as const
            }
        }
        return
    }

    public async handle(request: ICmdHandlerRequest<UICtx>): Promise<ICmdHandlerResponce> {
        const { command, text, userId, uiCtx, uiImpl, words: args, dispatcher } = request

        const builder = dispatcher.CommandBuilder
        const builderRes = await this.handleBuildProcess(userId, text, uiCtx, builder, dispatcher, uiImpl)
        if (builderRes) {
            return builderRes
        }

        try {
            const buildSetupRes = await this.startNewBuild(userId, command, args, uiCtx, builder, dispatcher)
            if (buildSetupRes) {
                return buildSetupRes
            }
        } catch(e: any) {
            log.error(`Cannot start build command: "${command}": ${e?.message ?? e}`, e)
        }

        return await super.handle(request)
    }
}
