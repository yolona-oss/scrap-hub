import { CmdArgumentContextType } from "./argument-context"
import { CmdArgumentMetadataRaw } from "./argument-decorator"
import { BranchedPairOptions } from "./argument-option-types"

export type ArgumentDescriptorType = 'positional'|'pair'|'standalone'

/** Path-aware resolver kept on the compiled descriptor. Local commands
 *  bind their function-form `pairOptions` directly; remote commands get
 *  an offline resolver synthesized from the manifest's tree snapshot. */
export type CompiledPairOptionsResolver = (path: string[]) => Promise<string[] | BranchedPairOptions>

/**
 * @description Defined argument descriptions to parse from raw input
 */
export interface IArgumentDescriptor extends CmdArgumentMetadataRaw {
    ctx: CmdArgumentContextType,
    name: string,
    /** Flat root-level options. Mirrors `pairOptionsResolver(path=[]).leaves`
     *  so first render of a tree menu has buttons immediately, and remains
     *  the only field set when the raw `pairOptions` was a literal string[]. */
    pairOptions?: string[]
    /** Path-aware resolver. Present whenever the raw `pairOptions` was a
     *  function — even if it returns flat `string[]` at the root. The
     *  builder calls it on each descent to render the level's options. */
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
