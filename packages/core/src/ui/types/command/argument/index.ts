// Argument authoring primitives live in @cmd-hub/common. This barrel
// re-exports the new tree-native API that the hub-side parser, builder,
// and built-ins consume. The old descriptor/positional/branched-options
// surface is gone — leaves carry their own static `options[]`.

export {
    CmdArgument,
    buildTreeFromClass,
    branch,
    leaf,
    walkLeaves,
    flattenValue,
    unflattenValue,
    nodeAtPath,
    CmdArgumentProxy,
    PAIR_PATH_DELIMITER,
} from '@cmd-hub/common'

export type {
    OptionsTree,
    LeafSpec,
    BranchSpec,
    LeafType,
    LeafOptions,
    BranchOptions,
    LeafValidator,
    DisplayHint,
    CmdArgumentDef,
} from '@cmd-hub/common'
