import { WithNeighbors } from "@cmd-hub/common"
import { ICmdArgumentDefinition, IArgumentDescriptor, IArgumentCompiled, CmdArgumentMetadataRaw } from "./argument"
import { BaseCommandService } from './service'
import { BaseUIContext, IUI } from "../../../ui"

/**
 * @description Describes the UI command base definition mapping
 * command - collable command name
 * args - class with fields described with metadata
 */
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

/** RENAME IT! */
export type IUICommandWithOutArgs = Omit<CommandSklet, "args">

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

export function isFunc(mixin: IvokeableType<any>): mixin is ICmdFunction<any> {
    return typeof mixin === "function"
}

export function isService(mixin: IvokeableType<any>): mixin is ICmdService {
    return !isFunc(mixin)
}

// invokable types
type FuncResultType = ({error?: string})|void
export type ICmdFunction<Ctx extends BaseUIContext> = (args: CmdArgumentProxy, ctx: Ctx, uiImpl: IUI<Ctx>) => Promise<FuncResultType>
//export type ICmdObscuredFunction<Ctx> = (ctx: Ctx, ...args: any[]) => Promise<FuncResultType>
export type ICmdService = BaseCommandService<any>
export type IvokeableType<UICtxType extends BaseUIContext> = ICmdFunction<UICtxType> | ICmdService

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
