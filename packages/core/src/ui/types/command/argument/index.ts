// Argument authoring primitives live in @cmd-hub/common. This barrel
// re-exports the new tree-native API that the hub-side parser, builder,
// and built-ins consume. The old descriptor/positional/branched-options
// surface is gone — leaves carry their own static `choices[]`.

export {
    CmdArg,
    buildArgTreeFromClass,
    argBranch,
    argLeaf,
    walkArgLeaves,
    flattenArgs,
    unflattenArgs,
    argNodeAtPath,
    CmdArgumentProxy,
    ARG_PATH_DELIMITER,
} from '@cmd-hub/common'

export type {
    ArgTree,
    ArgLeaf,
    ArgBranch,
    ArgValueType,
    ArgLeafDef,
    ArgBranchDef,
    ArgValidator,
    DisplayHint,
    ArgDef,
} from '@cmd-hub/common'
