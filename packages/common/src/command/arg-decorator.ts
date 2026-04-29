import { defineDecoratorMeta, readDecoratorMeta, makeMetaKey } from './metadata'
import {
    argBranch,
    argLeaf,
    type ArgLeafDef,
    type ArgBranchDef,
    type ArgLeaf,
    type ArgTree,
    type ArgValueType,
    type ArgValidator,
} from './tree'

/**
 * Decorator that marks a property as a node in the command's arg tree.
 *
 * - Properties whose `design:type` is a constructable class become `branch`
 *   nodes; their inner class is walked recursively.
 * - All other properties become `leaf` nodes; the decorator's options
 *   (type / required / position / standalone / default / choices /
 *   validator / displayHint / description / persistent) populate the leaf.
 *
 * Leaves with a static `choices: string[]` are the only declarative way
 * to constrain values — runtime resolvers can't cross the wire.
 *
 * Leaves with `persistent: true` participate in the layered account/session
 * store; without it (default), the leaf is per-invocation only.
 */

export const CMD_ARG_META_KEY = makeMetaKey('CmdArg')
const DESIGN_TYPE_KEY = 'design:type'

export interface ArgDef extends ArgLeafDef {
    branch?: boolean | ArgBranchDef
    childClass?: new () => object
}

export function CmdArg(metadata: ArgDef = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (target: any, propertyKey: string) => {
        const reflected = (target && target[DESIGN_TYPE_KEY])
            ?? readDesignType(target, propertyKey)
        const explicitBranch = metadata.branch !== undefined && metadata.branch !== false
        const isBranch = explicitBranch || isConstructable(metadata.childClass) || isConstructable(reflected)

        const bag = readDecoratorMeta<DecoratorBag>(CMD_ARG_META_KEY, target) ?? {}
        if (isBranch) {
            const branchOpts: ArgBranchDef =
                metadata.branch && typeof metadata.branch === 'object'
                    ? metadata.branch
                    : { description: metadata.description, displayHint: metadata.displayHint }
            const childClass = metadata.childClass ?? reflected as (new () => object) | undefined
            if (!childClass) {
                throw new Error(
                    `@CmdArg on "${String(propertyKey)}": branch nodes require either a class-typed property ` +
                    `(emitMetadata + class type) or an explicit \`childClass\` option.`,
                )
            }
            bag[propertyKey] = { kind: 'branch', branch: branchOpts, childClass }
        } else {
            const leafOpts: ArgLeafDef & { type: ArgValueType } = {
                type: metadata.type ?? inferLeafType(reflected) ?? 'string',
                required: metadata.required,
                position: metadata.position,
                standalone: metadata.standalone,
                default: metadata.default,
                description: metadata.description,
                choices: metadata.choices,
                validator: metadata.validator,
                displayHint: metadata.displayHint,
                persistent: metadata.persistent,
            }
            bag[propertyKey] = { kind: 'leaf', leaf: leafOpts }
        }
        defineDecoratorMeta(CMD_ARG_META_KEY, target, bag)
    }
}

/* -- introspection ---------------------------------------------------- */

type DecoratorEntry =
    | { kind: 'leaf'; leaf: ArgLeafDef & { type: ArgValueType } }
    | { kind: 'branch'; branch: ArgBranchDef; childClass: new () => object }

type DecoratorBag = Record<string, DecoratorEntry>

export function buildArgTreeFromClass(cls: new () => object): ArgTree {
    return walkClass(cls)
}

function walkClass(cls: new () => object): ArgTree {
    const bag = collectBag(cls)
    const children: Record<string, ArgTree> = {}
    for (const [propertyKey, entry] of Object.entries(bag)) {
        if (entry.kind === 'leaf') {
            children[propertyKey] = argLeaf(entry.leaf) as ArgLeaf
        } else {
            const sub = walkClass(entry.childClass) as ArgTree
            children[propertyKey] = sub.node === 'branch' && (entry.branch.description || entry.branch.displayHint)
                ? argBranch(mapBranchChildren(sub), entry.branch)
                : sub
        }
    }
    return argBranch(children)
}

function mapBranchChildren(b: ArgTree): Record<string, ArgTree> {
    if (b.node !== 'branch') {
        throw new Error('mapBranchChildren: expected a branch node')
    }
    const out: Record<string, ArgTree> = {}
    for (const [k, v] of b.children) out[k] = v
    return out
}

function collectBag(cls: new () => object): DecoratorBag {
    const merged: DecoratorBag = {}
    let proto = cls.prototype
    const stack: DecoratorBag[] = []
    while (proto && proto !== Object.prototype) {
        const bag = readDecoratorMeta<DecoratorBag>(CMD_ARG_META_KEY, proto)
        if (bag) stack.push(bag)
        proto = Object.getPrototypeOf(proto)
    }
    for (let i = stack.length - 1; i >= 0; i--) {
        const bag = stack[i]
        for (const [k, v] of Object.entries(bag)) merged[k] = v
    }
    return merged
}

function readDesignType(target: unknown, propertyKey: string): unknown {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (Reflect as any)
    if (typeof r?.getMetadata === 'function') {
        return r.getMetadata(DESIGN_TYPE_KEY, target as object, propertyKey)
    }
    return undefined
}

function isConstructable(v: unknown): v is new () => object {
    if (typeof v !== 'function') return false
    return v !== String && v !== Number && v !== Boolean && v !== Object && v !== Array
}

function inferLeafType(reflected: unknown): ArgValueType | undefined {
    if (reflected === String) return 'string'
    if (reflected === Number) return 'number'
    if (reflected === Boolean) return 'bool'
    return undefined
}

export type { ArgValidator }
