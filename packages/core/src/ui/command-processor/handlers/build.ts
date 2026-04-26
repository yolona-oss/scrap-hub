import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "../../../ui/types"
import { BaseUI } from "../../../ui/base-ui"
import { CommandBuilder } from "../builder"
import { CmdDispatcher } from "../dispatcher"
import log from '../../../application/logger'
import { CBDescriptorCompiler } from "../builder/desc-compiler"
import { IUICommandDescriptor, IUI } from "../../../ui/types"
import { isOneShot, formatEffectiveArgs } from "../../types/command"

// TODO add completion for builtin commands

export class HandleCmdBuilder<UICtx extends BaseUIContext> extends AbstractCmdHandler<UICtx> {

    private async startNewBuild(userId: string, command: string, args: string[], ctx: UICtx, builder: CommandBuilder, dispatcher: CmdDispatcher<UICtx>): Promise<ICmdHandlerResponce|void> {
        log.trace(`Checking for availability to start build: ${command}`)
        log.trace(`Command: ${command}\nArgs: ${args}`)
        // Skip the builder when the command is neither local (cmd_registry)
        // nor remote (manifest-aggregated). The chain falls through to the
        // invocation handler which surfaces a "no nodes eligible" / "command
        // not found" error rather than a stack trace from descCompiler.
        const known = dispatcher.tryGetInvokable(command) || dispatcher.tryGetRemoteCommand(command)
        if (!known) {
            return
        }
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
            let savedData: Record<string, unknown> | undefined
            if (dispatcher.isService(command)) {
                try {
                    const repos = dispatcher.repos
                    if (repos && ctx.manager?.userId !== undefined) {
                        const owner = await repos.manager.findByUserId(ctx.manager.userId)
                        if (owner?.accountId) {
                            const account = await repos.account.handleById(owner.accountId)
                            if (account) {
                                const { module } = await account.getModuleByNameOrCreate(command)
                                savedData = (module.record.data.config ?? undefined) as Record<string, unknown> | undefined
                            }
                        }
                    }
                } catch (_) {}
            }

            const res = await builder.startBuild(userId, command, desc, avalibleCtxs, undefined, savedData)

            return {
                success: true,
                markup: res,
                messageType: 'builder' as const
            }
        }
        return
    }

    private async handleBuildProcess(userId: string, text: string, ctx: UICtx, builder: CommandBuilder, dispatcher: CmdDispatcher<UICtx>, uiImpl: IUI<UICtx>): Promise<ICmdHandlerResponce|void> {
        if (builder.isUserOnBuild(userId)) {
            const stepRes = builder.handle(userId, text)

            if (stepRes.IsCompiled) {
                log.info(`exec (built): ${formatEffectiveArgs(stepRes.Result)}`)
                // Build complete — schedule cleanup of all builder messages
                if (uiImpl instanceof BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000)
                }

                // Local-first dispatch: built-ins live in the dispatcher's
                // own registry and don't exist on any cmd-node. Routing them
                // through RemoteCmdInvoker would always fail with "no nodes
                // eligible". Only fall through to the remote invoker for
                // commands NOT found locally.
                const localEntry = dispatcher.tryGetInvokable(stepRes.Result.command)
                if (localEntry && isOneShot(localEntry.invokable)) {
                    await localEntry.invokable.call(dispatcher, stepRes.Result.proxy, ctx, uiImpl)
                    return {
                        success: true,
                        markup: { text: '' },
                        messageType: 'system' as const,
                    }
                }

                const invoker = dispatcher.RemoteInvoker
                if (!invoker) {
                    return {
                        success: false,
                        markup: { text: 'No remote invoker attached to dispatcher' },
                        messageType: 'system' as const,
                    }
                }
                return await invoker.invokeLegacy(userId, stepRes.Result, ctx, uiImpl)
            }

            if (stepRes.Done) {
                // Build cancelled — schedule cleanup of all builder messages
                if (uiImpl instanceof BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000)
                }
            }

            return {
                success: !Boolean(stepRes),
                markup: await stepRes.Markup,
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
        } catch(e: unknown) {
            log.error(`Cannot start build command: "${command}": ${(e as Error)?.message ?? e}`, e)
        }

        return await super.handle(request)
    }
}
