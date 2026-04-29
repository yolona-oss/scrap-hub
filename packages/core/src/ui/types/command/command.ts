import { WithNeighbors, type ArgTree, CmdArgumentProxy } from "@cmd-hub/common"
import { BaseCommandService } from './service'
import { BaseUIContext, IUI } from "../../../ui"

/** Constructable data class decorated with `@CmdArg` properties.
 *  Built-ins reference one of these on `CommandSklet.args` so the
 *  desc-compiler can synthesize an `ArgTree` via `buildArgTreeFromClass`. */
export type CmdArgsClass = new () => object

/** Hub UI routing metadata. Intentionally NOT extending
 *  `BaseCommandIdentity` from `@cmd-hub/common` — built-ins don't carry
 *  `compatibilityId`/`version` (no remote pool to route through). For the
 *  kinship between this and `CmdServiceMeta`/`CmdOneShotMeta` see
 *  `BaseCommandIdentity`. */
interface CommandSklet extends Partial<WithNeighbors> {
    readonly command: string
    readonly description: string
    args?: CmdArgsClass
}

/** @description Describes the UI bound command base definition */
export type IUICommand = CommandSklet

/** @description IUICommand with the parsed options tree attached. The
 *  tree is the canonical source of truth for what arguments the command
 *  accepts; UIs render it directly. */
export interface IUICommandProcessed extends IUICommand {
    readonly options: ArgTree
}

export interface ICommandCompiled {
    readonly command: string
    readonly proxy: CmdArgumentProxy
    /** Flat slash-delimited dot-path → string-value map. The dispatcher
     *  ships this verbatim as the proto `args` map. */
    readonly raw: ReadonlyMap<string, string>
}

/** Single-line summary of a compiled command's effective arguments —
 *  every committed leaf with the value the dispatcher will actually pass
 *  to the invokable. Used at the build-and-interpret → execute boundary
 *  so an operator can see exactly what got applied. */
export function formatEffectiveArgs(compiled: ICommandCompiled): string {
    if (compiled.raw.size === 0) return `/${compiled.command} (no args)`
    const parts: string[] = []
    for (const [path, value] of compiled.raw) {
        const v = value === '' || value == null ? '∅' : value
        parts.push(`${path}=${v}`)
    }
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

/** @description Describes the option tree the parser walks for one
 *  command. The root is whatever the desc-compiler synthesized: a
 *  branch with `args` / `intercom` children for services,
 *  the args-class tree for one-shots and built-ins, or a single leaf
 *  for argless commands. */
export interface IUICommandDescriptor {
    options: ArgTree
}
