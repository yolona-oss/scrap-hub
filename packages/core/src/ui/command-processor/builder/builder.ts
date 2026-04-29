import { IUICommandDescriptor } from '../../../ui/types'
import { BaseUIContext, UiUnicodeSymbols } from '../../../ui'
import { CBDescriptorCompiler } from './desc-compiler'
import { CmdDispatcher } from './../dispatcher'
import { CBInterpreter } from './interpreter'
import { BuilderMarkuper } from './builder-markuper'
import { IBaseMarkup } from '../types/markup'
import { CBParser } from './interpreter/parser'
import { EvaluationResult } from './ev-result'
import { anyToString } from '@cmd-hub/common'
import { InterpreterMode } from './interpreter/interpreter'
import log from '../../../application/logger'
import type { SavedSources } from '../saved-sources'

/**
 * Per-user command-builder session manager. Each user has at most one
 * active build at a time, keyed by `userId`. The dispatcher hands an
 * `IUICommandDescriptor` (a tree built by `CBDescriptorCompiler`) to
 * `startBuild`; subsequent user input flows through `handle()` which
 * forwards to the parser/interpreter via the user's `CBInterpreter`.
 */
export class CommandBuilder {
    private usersBuild: Map<string, CBInterpreter> = new Map()

    constructor() {}

    isUserOnBuild(userId: string): boolean {
        return this.usersBuild.has(userId)
    }

    private stopBuild(userId: string): void {
        this.usersBuild.delete(userId)
    }

    handle(userId: string, input: string): EvaluationResult {
        const interpreter = this.usersBuild.get(userId)
        if (!interpreter) {
            throw new Error(`User "${userId}" not on build`)
        }
        const res = interpreter.step(input)
        if (res.Done) {
            this.stopBuild(userId)
        }
        return res
    }

    async startBuild(
        userId: string,
        command: string,
        desc: IUICommandDescriptor,
        mode?: InterpreterMode,
        savedSources?: SavedSources,
        seededValues?: ReadonlyMap<string, string>,
    ): Promise<IBaseMarkup> {
        if (this.usersBuild.has(userId)) {
            throw new Error('User already has active build.')
        }
        if (desc.tree.node === 'branch' && desc.tree.children.size === 0) {
            throw new Error('No arguments in descriptor. Nothing to build.')
        }

        const parser = new CBParser({ command, descriptor: desc })
        parser.SavedSources = savedSources
        // Seed user-typed args before showing the intro so they outrank
        // session/module entries from `savedSources`. The parser surfaces
        // seeded leaves as user-committed; unfilled leaves fall through to
        // savedSources (session beats module — see loadSavedSources).
        if (seededValues && seededValues.size > 0) {
            parser.seedValues(seededValues)
        }
        const interpreter = new CBInterpreter(parser, mode)
        this.usersBuild.set(userId, interpreter)

        return BuilderMarkuper.intro(parser, savedSources)
    }

    /** Re-open a build with previously-committed values pre-seeded and
     *  a specific leaf marked as the next prompt. Used by the
     *  `validation_failed` re-prompt flow: after the node rejects a
     *  leaf's value, the dispatcher reopens the same builder with the
     *  rest of the user's input intact and the cursor parked on the
     *  failed leaf. Returns the rendered markup the UI should present. */
    async restartAtLeaf(
        userId: string,
        command: string,
        desc: IUICommandDescriptor,
        seededValues: ReadonlyMap<string, string>,
        failedLeafPath: readonly string[],
        mode?: InterpreterMode,
        savedSources?: SavedSources,
    ): Promise<IBaseMarkup> {
        // Drop any leftover build for this user (defensive — the previous
        // execute() should have cleared it via `handle`'s `Done` branch,
        // but a torn-down stream could leave one behind).
        this.usersBuild.delete(userId)
        const parser = new CBParser({ command, descriptor: desc })
        parser.SavedSources = savedSources
        parser.seedValues(seededValues)
        parser.focusLeaf(failedLeafPath)
        const interpreter = new CBInterpreter(parser, mode)
        this.usersBuild.set(userId, interpreter)
        return BuilderMarkuper.markup(parser, { text: { info: '' } })
    }

    /** Non-mandatory compilation: try to compile a one-shot command's
     *  arguments from a single line of free-form input. Used by built-in
     *  commands so `/help foo` runs without entering interactive build. */
    public async compile<UICtx extends BaseUIContext>(
        userId: string,
        command: string,
        input: string,
        ctx: UICtx,
        dispatcher: CmdDispatcher<UICtx>,
    ): Promise<EvaluationResult> {
        log.trace(`CommandBuilder: starting non-mandatory compilation for ${command}`)
        const descriptor = await descCompiler.compile(command, userId, dispatcher, ctx)
        const parser = new CBParser({ command, descriptor })
        const interpreter = new CBInterpreter(parser, 'non-mandatory')

        try {
            return interpreter.step(input)
        } catch (e) {
            throw new Error(
                `${UiUnicodeSymbols.cross} Non-mandatory compilation failed.\n` +
                `-- ${UiUnicodeSymbols.magnifierGlass} Input: ${UiUnicodeSymbols.arrowRight} "${input}"\n` +
                `-- ${UiUnicodeSymbols.magnifierGlass} Error: ${UiUnicodeSymbols.arrowRight} "${anyToString(e) || 'Unknown error'}"`,
            )
        }
    }
}

/** Shared `CBDescriptorCompiler` instance — the compiler is stateless,
 *  so reusing one avoids the per-call allocation in both the
 *  non-mandatory compile path and `handlers/build.ts`. */
export const descCompiler = new CBDescriptorCompiler()
