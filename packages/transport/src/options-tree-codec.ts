/**
 * Translate `OptionsTree` (the canonical in-memory shape from
 * `@cmd-hub/common/command/tree`) ↔ the proto `CommandOptionsTree`
 * recursive shape. Lives in transport because the proto types live here;
 * `@cmd-hub/common` doesn't import any transport-side types.
 *
 * Decision (logged): this file is the single boundary between the
 * decorator-time / runtime tree and the wire shape. Manifest emit
 * (`buildManifest`) calls `treeToProto`; descriptor compile
 * (`configureRemoteDesc`) calls `protoToTree`. Validators are dropped at
 * this boundary — they live only on the side where they were declared
 * (node-side), since functions can't cross the wire.
 */

import type {
    OptionsTree,
    LeafSpec,
    BranchSpec,
    LeafType,
    DisplayHint,
} from '@cmd-hub/common'
import { branch, leaf } from '@cmd-hub/common'
import * as CmdHubProto from './grpc/generated/cmd_node'

export function treeToProto(tree: OptionsTree): CmdHubProto.CommandOptionsTree {
    if (tree.node === 'leaf') {
        return { leaf: leafToProto(tree), branch: undefined }
    }
    return { leaf: undefined, branch: branchToProto(tree) }
}

function leafToProto(spec: LeafSpec): CmdHubProto.LeafNode {
    return {
        type: spec.type,
        required: spec.required,
        position: spec.position,
        standalone: spec.standalone,
        default: spec.default ?? '',
        options: [...spec.options],
        description: spec.description,
        displayHint: spec.displayHint ?? '',
    }
}

function branchToProto(spec: BranchSpec): CmdHubProto.BranchNode {
    const children: { [k: string]: CmdHubProto.CommandOptionsTree } = {}
    for (const [name, child] of spec.children) {
        children[name] = treeToProto(child)
    }
    return {
        children,
        description: spec.description,
        displayHint: spec.displayHint ?? '',
    }
}

export function protoToTree(proto: CmdHubProto.CommandOptionsTree | undefined): OptionsTree {
    if (!proto) return branch({})
    if (proto.leaf) return protoToLeaf(proto.leaf)
    if (proto.branch) return protoToBranch(proto.branch)
    // Empty oneof — treat as an empty branch root.
    return branch({})
}

function protoToLeaf(p: CmdHubProto.LeafNode): LeafSpec {
    const type: LeafType =
        p.type === 'number' ? 'number'
        : p.type === 'bool' ? 'bool'
        : 'string'
    return leaf({
        type,
        required: p.required,
        position: p.position,
        standalone: p.standalone,
        default: p.default || undefined,
        options: p.options,
        description: p.description,
        displayHint: (p.displayHint || undefined) as DisplayHint | undefined,
    })
}

function protoToBranch(p: CmdHubProto.BranchNode): BranchSpec {
    const children: Record<string, OptionsTree> = {}
    for (const [name, child] of Object.entries(p.children ?? {})) {
        children[name] = protoToTree(child)
    }
    return branch(children, {
        description: p.description,
        displayHint: (p.displayHint || undefined) as DisplayHint | undefined,
    }) as BranchSpec
}
