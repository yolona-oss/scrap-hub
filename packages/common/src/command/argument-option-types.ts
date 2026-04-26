// Type-only primitives for @CmdArgument option sets.
// Runtime `exposeCmdArgumentOptions` stays in @cmd-hub/core because it takes
// `CmdDispatcher` and `IManager` which belong to the runtime tier.

/** Default delimiter for hierarchical pair-option paths. `/` is preferred
 *  over `.` because realistic config values frequently contain dots
 *  (model names like `qwen2.5:7b`, version strings, API URLs). Authors
 *  with their own collision concerns can override via
 *  `IArgumentDescriptor.pairOptionsSeparator`. */
export const PAIR_PATH_DELIMITER = '/'

/** Sentinel prefix on button `data` strings that distinguishes a "drill
 *  deeper" branch click from a "commit value" leaf click. Stripped by the
 *  parser before processing. The codepoint is unlikely to appear in user
 *  data while still being printable in case logs leak. */
export const PAIR_BRANCH_PREFIX = '»' // » (right double angle)

/** Hierarchical pair-options. Buttons in `branches` drill deeper; buttons
 *  in `leaves` commit a value (joined with `PAIR_PATH_DELIMITER`). */
export interface BranchedPairOptions {
    branches: string[]
    leaves: string[]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SetterPattern = (...args: any[]) => Promise<string[] | BranchedPairOptions>

/**
 * Generic signature for a runtime option-setter used by `@CmdArgument({ pairOptions })`.
 * Parameterised by the concrete dispatcher and manager types so @cmd-hub/common
 * avoids a runtime back-dependency on @cmd-hub/core.
 *
 * `path` is the trail of branches the user has drilled into. The desc-
 * compiler invokes the resolver with `path=[]` at compile time and the
 * builder re-invokes with deeper paths as the user drills. `undefined`
 * is treated identically to `[]` — flat-options callers can omit it.
 * Resolvers returning `BranchedPairOptions` MUST be marked with
 * `@CmdArgument({ branched: true })` so the descriptor compiler keeps
 * the resolver bound for re-invocation at deeper levels.
 */
export type CmdArgumentOptionSetterGeneric<Dispatcher, Manager> = (
    cmdName: string,
    dispatcher: Dispatcher,
    manager: Manager,
    path?: string[],
) => Promise<string[] | BranchedPairOptions>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CmdArgumentOptionSetter = CmdArgumentOptionSetterGeneric<any, any>

export type CmdArgumentPairOptionsType<OptionsSetter extends SetterPattern = CmdArgumentOptionSetter> =
    string[] | OptionsSetter

export function isOptionSetterFunc<OptionsSetter extends SetterPattern = CmdArgumentOptionSetter>(
    options: CmdArgumentPairOptionsType<OptionsSetter>,
): options is OptionsSetter {
    return typeof options === 'function'
}

export function isOptionSetterString(options: CmdArgumentPairOptionsType): options is string[] {
    return Array.isArray(options)
}

export function isBranched(o: string[] | BranchedPairOptions): o is BranchedPairOptions {
    return !Array.isArray(o)
        && Array.isArray((o as BranchedPairOptions).branches)
        && Array.isArray((o as BranchedPairOptions).leaves)
}
