// Runtime option-setter helper + narrowed type aliases.
// The generic `CmdArgumentOptionSetterGeneric` lives in @cmd-hub/common;
// cmd-hub re-exports it narrowed so decorators authored on the hub side get
// full dispatcher / manager inference without annotating every callback.

import type {
    CmdArgumentOptionSetterGeneric,
    CmdArgumentPairOptionsType as CommonPair,
    BranchedPairOptions,
    CompiledPairOptionsResolver,
    ManagerRecord,
} from "@cmd-hub/common"
import {
    isOptionSetterFunc as commonIsOptionSetterFunc,
    isOptionSetterString,
    isBranched,
} from "@cmd-hub/common"
import { BaseUIContext } from "../../../../ui"
import { CmdDispatcher } from "../../../../ui/command-processor"

export type CmdArgumentOptionSetter = CmdArgumentOptionSetterGeneric<CmdDispatcher<any>, ManagerRecord>
export type CmdArgumentPairOptionsType<
    OptionsSetter extends (...args: any[]) => Promise<string[] | BranchedPairOptions> =
        (...args: any[]) => Promise<string[] | BranchedPairOptions>,
> = CommonPair<OptionsSetter>

export const isOptionSetterFunc = commonIsOptionSetterFunc
export { isOptionSetterString, isBranched }

/** Resolve flat options. Returns `undefined` for unset, a literal array
 *  passthrough, or the resolver's path-empty result coerced to a flat
 *  list (any branched result is collapsed by taking only `leaves`).
 *  Use `bindBranchedResolver` when a branched arg needs its full
 *  hierarchy preserved on the compiled descriptor. */
export async function exposeCmdArgumentOptions<CtxType extends BaseUIContext = any>(
    cmdName: string,
    options: CmdArgumentPairOptionsType<CmdArgumentOptionSetter> | undefined,
    dispatcher: CmdDispatcher<CtxType>,
    manager: ManagerRecord,
): Promise<string[] | undefined> {
    if (options instanceof Function) {
        const result = await options(cmdName, dispatcher, manager, [])
        return isBranched(result) ? result.leaves : result
    } else if (Array.isArray(options)) {
        return options
    } else {
        return undefined
    }
}

/** Bind a path-aware resolver for use on a compiled descriptor. The
 *  parser/markuper will call the returned closure with each new path
 *  level as the user drills the menu. Throws if `options` is not a
 *  function (branched mode requires a resolver). */
export function bindBranchedResolver<CtxType extends BaseUIContext = any>(
    cmdName: string,
    options: CmdArgumentPairOptionsType<CmdArgumentOptionSetter> | undefined,
    dispatcher: CmdDispatcher<CtxType>,
    manager: ManagerRecord,
): CompiledPairOptionsResolver | undefined {
    if (!(options instanceof Function)) return undefined
    return (path: string[]) => options(cmdName, dispatcher, manager, path)
}
