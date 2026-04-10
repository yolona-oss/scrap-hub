import { CmdArgumentContextType } from "./context"
import { CmdArgumentMetadataRaw } from "./meta"

export type ArgumentDescriptorType = 'positional'|'pair'|'standalone'

/**
 * @description Defined argument descriptions to parse from raw input
 */
export interface IArgumentDescriptor extends CmdArgumentMetadataRaw {
    ctx: CmdArgumentContextType,
    name: string,
    pairOptions?: string[]
}

/**
 * @description Parsed argument, ready to use in command transpiler
 */
export interface IArgumentCompiled extends Pick<IArgumentDescriptor, 'ctx'|'name'|'standalone'|'position'|'isPair'> {
    value: string
}

export type IArgumentIdent = Pick<IArgumentDescriptor, 'ctx'|'name'|'position'|'isPair'|'standalone'>
