/**
 * recursive shape. Lives in transport because the proto types live here;
 * `@cmd-hub/common` doesn't import any transport-side types.
 *
 * Decision (logged): this file is the single boundary between the
 * decorator-time / runtime tree and the wire shape. Manifest emit
 * (`buildManifest`) calls `treeToProto`; descriptor compile
 * (`configureRemoteDesc`) calls `protoToTree`. Validators are dropped at
 * this boundary — they live only on the side where they were declared
 * (node-side), since functions can't cross the wire
 */

import type {
    ArgTree,
    ArgLeaf,
    ArgBranch,
    ArgValueType,
    DisplayHint,
} from '@cmd-hub/common'
import { argLeaf, argBranch } from '@cmd-hub/common'
import * as CmdHubProto from './grpc/generated/cmd_node'

export function treeToProto(tree: ArgTree): CmdHubProto.CommandArgTree {
    if (tree.node === 'leaf') {
        return { leaf: leafToProto(tree), branch: undefined }
    }
    return { leaf: undefined, branch: branchToProto(tree) }
}

function leafToProto(spec: ArgLeaf): CmdHubProto.ArgLeafNode {
    return {
        type: spec.type,
        required: spec.required,
        position: spec.position,
        standalone: spec.standalone,
        default: spec.default ?? '',
        choices: [...spec.choices],
        description: spec.description,
        displayHint: spec.displayHint ?? '',
        persistent: spec.persistent,
    }
}

function branchToProto(spec: ArgBranch): CmdHubProto.ArgBranchNode {
    const children: { [k: string]: CmdHubProto.CommandArgTree } = {}
    for (const [name, child] of spec.children) {
        children[name] = treeToProto(child)
    }
    return {
        children,
        description: spec.description,
        displayHint: spec.displayHint ?? '',
    }
}

export function protoToTree(proto: CmdHubProto.CommandArgTree | undefined): ArgTree {
    if (!proto) return argBranch({})
    if (proto.leaf) return protoToLeaf(proto.leaf)
    if (proto.branch) return protoToBranch(proto.branch)
    // Empty oneof — treat as an empty branch root.
    return argBranch({})
}

function protoToLeaf(p: CmdHubProto.ArgLeafNode): ArgLeaf {
    const type: ArgValueType =
        p.type === 'number' ? 'number'
            : p.type === 'bool' ? 'bool'
                : 'string'
    return argLeaf({
        type,
        required: p.required,
        position: p.position,
        standalone: p.standalone,
        default: p.default || undefined,
        choices: p.choices,
        description: p.description,
        displayHint: (p.displayHint || undefined) as DisplayHint | undefined,
        persistent: p.persistent,
    })
}

function protoToBranch(p: CmdHubProto.ArgBranchNode): ArgBranch {
    const children: Record<string, ArgTree> = {}
    for (const [name, child] of Object.entries(p.children ?? {})) {
        children[name] = protoToTree(child)
    }
    return argBranch(children, {
        description: p.description,
        displayHint: (p.displayHint || undefined) as DisplayHint | undefined,
    })
}
