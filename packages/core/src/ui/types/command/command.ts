import { WithNeighbors } from "@cmd-hub/common"
import { ICmdArgumentDefinition, IArgumentDescriptor, IArgumentCompiled, CmdArgumentMetadataRaw } from "./argument"
import { BaseCommandService } from './service'
import { BaseUIContext, IUI } from "../../../ui"

/** Hub UI routing metadata. Intentionally NOT extending
 *  `BaseCommandIdentity` from `@cmd-hub/common` — built-ins don't carry
 *  `compatibilityId`/`version` (no remote pool to route through). For the
 *  kinship between this and `CmdServiceMeta`/`CmdOneShotMeta` see
 *  `BaseCommandIdentity`. */
interface CommandSklet extends Partial<WithNeighbors> {
    readonly command: string
    readonly description: string
    args?: ICmdArgumentDefinition
}

/** @description Describes the UI bound command base definition */
export type IUICommand = CommandSklet

/** @description IUICommand with arguments read metadata */
export interface IUICommandProcessed extends IUICommand {
    readonly args: (CmdArgumentMetadataRaw & {name: string})[]
}

import { CmdArgumentProxy } from "../../../ui/command-processor/arg-proxy"

export interface ICommandCompiled {
    readonly command: string
    readonly proxy: CmdArgumentProxy
    readonly raw: IArgumentCompiled[]
}

/** Single-line summary of a compiled command's effective arguments — every
 *  declared argument with the value the dispatcher will actually pass to the
 *  invokable, including empties for unset/default args. Used at the
 *  build-and-interpret → execute boundary so an operator can see exactly
 *  what got applied. */
export function formatEffectiveArgs(compiled: ICommandCompiled): string {
    if (compiled.raw.length === 0) return `/${compiled.command} (no args)`
    const parts = compiled.raw.map(a => {
        const v = a.value === '' || a.value == null ? '∅' : a.value
        return `${a.name}=${v}`
    })
    return `/${compiled.command} ${parts.join(' ')}`
}

export function isOneShot(mixin: IvokeableType<any>): mixin is ICmdOneShot<any> {
    return typeof mixin === "function"
}

export function isService(mixin: IvokeableType<any>): mixin is ICmdService {
    return !isOneShot(mixin)
}

// invokable types
type OneShotResultType = ({error?: string})|void
/** Hub-side one-shot callback. Distinct from the node-side
 *  `CmdOneShotInvokable` in `@cmd-hub/common`: that one runs on the node
 *  with a thin emit-based context; this one runs in the hub UI dispatcher
 *  with the populated arg proxy + UI context + IUI handle. */
export type ICmdOneShot<Ctx extends BaseUIContext> = (args: CmdArgumentProxy, ctx: Ctx, uiImpl: IUI<Ctx>) => Promise<OneShotResultType>
export type ICmdService = BaseCommandService<any>
export type IvokeableType<UICtxType extends BaseUIContext> = ICmdOneShot<UICtxType> | ICmdService

/**
 * IUICommand with invokable object to ui command.
 * Mapped to use in dispatcher
 */
export interface IUI_InvokableCommand<Ctx extends BaseUIContext> extends IUICommandProcessed {
    readonly invokable: IvokeableType<Ctx>
}

/** @description Describes the UI commands mapping to parse from */
export interface IUICommandDescriptor {
    args: IArgumentDescriptor[]
}
