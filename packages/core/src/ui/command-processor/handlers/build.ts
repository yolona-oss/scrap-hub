import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "../../../ui/types"
import { BaseUI } from "../../../ui/base-ui"
import { CommandBuilder, descCompiler } from "../builder"
import { CmdDispatcher } from "../dispatcher"
import log from '../../../application/logger'
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
            const desc: IUICommandDescriptor = await descCompiler.compile(command, userId, dispatcher, ctx)

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

            const res = await builder.startBuild(userId, command, desc, undefined, savedData)

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
                const compiled = stepRes.Result
                const invokeRes = await invoker.invokeLegacy(userId, compiled, ctx, uiImpl)
                if (invokeRes.validationFailed) {
                    // Re-prompt the failed leaf without losing the rest
                    // of the user's input. The re-opened build is seeded
                    // with everything they already committed; the parser
                    // is parked on the failed leaf so the next TEXT
                    // commits the corrected value.
                    const desc = await descCompiler.compile(compiled.command, userId, dispatcher, ctx)
                    const failedPath = invokeRes.validationFailed.argPath
                        .split('/')
                        .filter(s => s.length > 0)
                    const markup = await builder.restartAtLeaf(
                        userId, compiled.command, desc,
                        compiled.raw, failedPath,
                    )
                    return {
                        success: true,
                        markup,
                        messageType: 'builder' as const,
                    }
                }
                return invokeRes
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
