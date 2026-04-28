import { AbstractCmdHandler, ICmdHandlerRequest, ICmdHandlerResponce } from "./abstract-handler"
import { BaseUIContext } from "../../../ui/types"
import { BaseUI } from "../../../ui/base-ui"
import { CommandBuilder, descCompiler } from "../builder"
import { CmdDispatcher } from "../dispatcher"
import log from '../../../application/logger'
import { IUICommandDescriptor, IUI } from "../../../ui/types"
import { isOneShot, formatEffectiveArgs } from "../../types/command"
import { walkLeaves, type OptionsTree } from "@cmd-hub/common"
import { loadSavedSources, type SavedSources } from "../saved-sources"
import { CBParser } from "../builder/interpreter/parser"
import { Lexer } from "../builder/interpreter/lexer"

const NOW_FLAG = '-now'

interface CoverageResult {
    covered: boolean
    missing: string[]
    /** Merged args that should ship over the wire if covered === true. */
    effectiveArgs: Record<string, string>
}

/** Strip the `-now` token from `args` and return both the rest and a
 *  flag indicating whether it was present. */
function extractNowFlag(args: string[]): { rest: string[]; nowSet: boolean } {
    let nowSet = false
    const rest: string[] = []
    for (const a of args) {
        if (a === NOW_FLAG) { nowSet = true; continue }
        rest.push(a)
    }
    return { rest, nowSet }
}

/** Compute coverage for `-now`: every required leaf in `tree` must
 *  appear in `typedArgs` (a flat dot-path map) OR in `saved`. Returns
 *  the merged args map and the list of any missing required keys. */
function computeNowCoverage(
    tree: OptionsTree,
    typedArgs: ReadonlyMap<string, string>,
    saved: SavedSources,
): CoverageResult {
    const merged: Record<string, string> = {}
    for (const [k, entry] of saved) merged[k] = entry.value
    for (const [k, v] of typedArgs) merged[k] = v

    const missing: string[] = []
    for (const { pathKey, leaf } of walkLeaves(tree)) {
        if (!leaf.required) continue
        if (merged[pathKey] === undefined || merged[pathKey] === '') {
            missing.push(pathKey)
        }
    }
    return { covered: missing.length === 0, missing, effectiveArgs: merged }
}

export class HandleCmdBuilder<UICtx extends BaseUIContext> extends AbstractCmdHandler<UICtx> {

    private async loadSaved(
        command: string,
        ctx: UICtx,
        dispatcher: CmdDispatcher<UICtx>,
    ): Promise<SavedSources> {
        if (!dispatcher.isService(command)) return new Map()
        if (ctx.manager?.userId === undefined) return new Map()
        const repos = dispatcher.repos
        if (!repos) return new Map()
        return loadSavedSources(repos, String(ctx.manager.userId), command)
    }

    /** Parse `args` (without the -now flag) into a flat dot-path map.
     *  Uses the same tokenizer/parser the builder uses, but operates
     *  on the raw command tree rather than the descriptor — sidesteps
     *  the descCompiler so this works for remote services without a
     *  fully-decoded proto descriptor. */
    private parseTypedArgs(
        command: string,
        tree: OptionsTree,
        args: string[],
    ): Map<string, string> {
        if (args.length === 0) return new Map()
        try {
            const parser = new CBParser({ command, descriptor: { options: tree } })
            const lexer = new Lexer()
            lexer.setInput(args.join(' '))
            for (const tkn of lexer.tokenizeCurrent()) {
                parser.parseNextToken(tkn)
            }
            return new Map(parser.Values)
        } catch (e) {
            log.debug(`HandleCmdBuilder.parseTypedArgs: ${(e as Error).message}`)
        }
        return new Map()
    }

    private async startNewBuild(
        userId: string,
        command: string,
        args: string[],
        ctx: UICtx,
        builder: CommandBuilder,
        dispatcher: CmdDispatcher<UICtx>,
        uiImpl: IUI<UICtx>,
    ): Promise<ICmdHandlerResponce|void> {
        log.trace(`Checking for availability to start build: ${command}`)
        log.trace(`Command: ${command}\nArgs: ${args}`)
        const known = dispatcher.tryGetInvokable(command) || dispatcher.tryGetRemoteCommand(command)
        if (!known) return

        const { rest: argsNoFlag, nowSet } = extractNowFlag(args)

        const savedSources = await this.loadSaved(command, ctx, dispatcher)

        if (nowSet && dispatcher.isService(command)) {
            const tree = dispatcher.getCommandTree(command)
            if (tree) {
                const typed = this.parseTypedArgs(command, tree, argsNoFlag)
                const coverage = computeNowCoverage(tree, typed, savedSources)
                if (coverage.covered) {
                    return await this.dispatchNow(command, userId, coverage.effectiveArgs, ctx, uiImpl, dispatcher)
                }
                // Missing required → fall through to the builder with an info line.
                log.info(`-now on /${command}: missing required leaves: ${coverage.missing.join(', ')}; opening builder`)
                const desc: IUICommandDescriptor = await descCompiler.compile(command, userId, dispatcher, ctx)
                const res = await builder.startBuild(userId, command, desc, undefined, savedSources)
                return {
                    success: true,
                    markup: {
                        text: `${res.text}\n\nmissing required: ${coverage.missing.join(', ')}`,
                        buttons: res.buttons,
                    },
                    messageType: 'builder' as const,
                }
            }
        }

        if (!dispatcher.isAllArgsPassed(command, argsNoFlag)) {
            const desc: IUICommandDescriptor = await descCompiler.compile(command, userId, dispatcher, ctx)
            const res = await builder.startBuild(userId, command, desc, undefined, savedSources)
            return {
                success: true,
                markup: res,
                messageType: 'builder' as const,
            }
        }
        return
    }

    private async dispatchNow(
        command: string,
        userId: string,
        effectiveArgs: Record<string, string>,
        ctx: UICtx,
        uiImpl: IUI<UICtx>,
        dispatcher: CmdDispatcher<UICtx>,
    ): Promise<ICmdHandlerResponce> {
        const invoker = dispatcher.RemoteInvoker
        if (!invoker) {
            return {
                success: false,
                markup: { text: 'No remote invoker attached to dispatcher' },
                messageType: 'system' as const,
            }
        }
        log.info(`exec (now): /${command} args=${JSON.stringify(effectiveArgs)}`)
        const res = await invoker.invoke({
            command,
            args: effectiveArgs,
            userId,
            uiHandle: { ctx, uiImpl },
            uiName: uiImpl.ContextType(),
        })
        return res
    }

    private async handleBuildProcess(userId: string, text: string, ctx: UICtx, builder: CommandBuilder, dispatcher: CmdDispatcher<UICtx>, uiImpl: IUI<UICtx>): Promise<ICmdHandlerResponce|void> {
        if (builder.isUserOnBuild(userId)) {
            const stepRes = builder.handle(userId, text)

            if (stepRes.IsCompiled) {
                log.info(`exec (built): ${formatEffectiveArgs(stepRes.Result)}`)
                if (uiImpl instanceof BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000)
                }

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
            const buildSetupRes = await this.startNewBuild(userId, command, args, uiCtx, builder, dispatcher, uiImpl)
            if (buildSetupRes) {
                return buildSetupRes
            }
        } catch(e: unknown) {
            log.error(`Cannot start build command: "${command}": ${(e as Error)?.message ?? e}`, e)
        }

        return await super.handle(request)
    }
}
