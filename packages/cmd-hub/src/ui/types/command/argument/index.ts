// Argument authoring primitives live in @cmd-hub/common. This barrel stays as
// a compatibility shim so existing `@core/ui/types/command/argument` imports
// keep resolving. `option` keeps its own runtime helper (`exposeCmdArgumentOptions`)
// locally, so re-export it explicitly to preserve name-shadowing over the
// common re-exports.

// Values (functions, const symbols).
export {
    encodePositionalName,
    decodePositionalName,
    validateArgumentDescriptor,
    getArgumentDescType,
    isArgumentDescStandalone,
    isArgumentDescPositional,
    isArgumentDescPair,
    compileArgumentFromDesc,
    CmdArgument,
    getCmdArgMetadata,
    COMMAND_ARG_DESC_KEY,
} from '@cmd-hub/common'

// Types. `isolatedModules` requires `export type` for type-only re-exports.
export type {
    CmdArgumentContextType,
    ArgumentDescriptorType,
    IArgumentDescriptor,
    IArgumentCompiled,
    IArgumentIdent,
    CmdArgumentMetadataRaw,
    CmdArgumentMetadataDef,
    CommandMetadata,
    CommandArgumentKeyHolder,
    ICmdArgumentDefinition,
    ICmdArgumentDefenition,
} from '@cmd-hub/common'

// `./option` re-exports the option TYPES (`CmdArgumentOptionSetter`,
// `CmdArgumentPairOptionsType`) along with the runtime `exposeCmdArgumentOptions`
// and type guards (`isOptionSetterFunc`, `isOptionSetterString`). Using the
// namespace barrel keeps the argument package's public surface identical to
// the old monolith.
export * from './option'
