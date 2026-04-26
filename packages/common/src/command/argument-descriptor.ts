import { CmdArgumentContextType } from "./argument-context"
import { CmdArgumentMetadataRaw } from "./argument-decorator"
import { BranchedPairOptions } from "./argument-option-types"

export type ArgumentDescriptorType = 'positional'|'pair'|'standalone'

/** Resolver kept on the compiled descriptor for branched pair-options. The
 *  desc-compiler binds dispatcher/manager/cmdName upfront; only `path` is
 *  passed at call time. */
export type CompiledPairOptionsResolver = (path: string[]) => Promise<string[] | BranchedPairOptions>

/**
 * @description Defined argument descriptions to parse from raw input
 */
export interface IArgumentDescriptor extends CmdArgumentMetadataRaw {
    ctx: CmdArgumentContextType,
    name: string,
    /** Flat option list. Set when `branched` is false (or absent) and
     *  the raw `pairOptions` was either a literal `string[]` or a flat
     *  resolver. The builder renders these as leaf buttons. */
    pairOptions?: string[]
    /** Path-aware resolver. Set when `@CmdArgument({ branched: true })`.
     *  The builder calls it on each descent to render the level's
     *  branches/leaves. */
    pairOptionsResolver?: CompiledPairOptionsResolver
    /** Override `PAIR_PATH_DELIMITER` for this argument's commits. */
    pairOptionsSeparator?: string
}

/**
 * @description Parsed argument, ready to use in command transpiler
 */
export interface IArgumentCompiled extends Pick<IArgumentDescriptor, 'ctx'|'name'|'standalone'|'position'|'isPair'> {
    value: string
}

export type IArgumentIdent = Pick<IArgumentDescriptor, 'ctx'|'name'|'position'|'isPair'|'standalone'>
