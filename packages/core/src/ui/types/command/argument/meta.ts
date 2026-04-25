// Moved to @cmd-hub/common. Kept as a re-export stub so existing imports keep
// resolving until the distributed split lands.
export {
    CmdArgument,
    getCmdArgMetadata,
    COMMAND_ARG_DESC_KEY,
} from '@cmd-hub/common'

export type {
    CmdArgumentMetadataRaw,
    CmdArgumentMetadataDef,
    CommandMetadata,
    CommandArgumentKeyHolder,
} from '@cmd-hub/common'
