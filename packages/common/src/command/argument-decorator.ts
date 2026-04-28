import { defineDecoratorMeta, readDecoratorMeta, makeMetaKey } from './metadata'
import {
    branch,
    leaf,
    type LeafOptions,
    type BranchOptions,
    type LeafSpec,
    type OptionsTree,
    type LeafType,
    type LeafValidator,
} from './tree'

/**
 * Decorator that marks a property as a node in the command's options tree.
 *
 * - Properties whose `design:type` is a constructable class become `branch`
 *   nodes; their inner class is walked recursively.
 * - All other properties become `leaf` nodes; the decorator's options
 *   (type / required / position / standalone / default / options /
 *   validator / displayHint / description) populate the leaf.
 *
 * The `pairOptions` / `pairOptionsResolver` / `branched` API is gone —
 * a leaf carrying a static `options: string[]` is the only supported
 * way to constrain values declaratively.
 */

export const COMMAND_ARG_DESC_KEY = makeMetaKey('CmdArgument')
const DESIGN_TYPE_KEY = 'design:type'

/** What the decorator stores per property. The desugarer reads this and
 *  produces an `OptionsTree`. The two shapes are mutually exclusive but
 *  carried in one bag for storage simplicity. */
export interface CmdArgumentMetadataRaw {
    readonly leaf?: LeafOptions & { type: LeafType }
    readonly branch?: BranchOptions
}

/** Public input shape. Everything is optional; the desugarer fills defaults
 *  per `tree.ts:leaf()` / `tree.ts:branch()`. Provide `branch: true` (or
 *  `branch: { ... }`) only when the property's design-time type is a class
 *  AND you want to override branch metadata; otherwise the decorator infers
 *  branch-vs-leaf from the property's reflected class type. */
export interface CmdArgumentDef extends LeafOptions {
    /** Override branch metadata. When `true`, treats the property as a
     *  branch even if reflect-metadata didn't see a class type (rare). */
    branch?: boolean | BranchOptions
    /** When the decorator can't reflect the class type (e.g. forward
     *  references), supply it explicitly. The class is walked at build
     *  time. */
    childClass?: new () => object
}

export function CmdArgument(metadata: CmdArgumentDef = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (target: any, propertyKey: string) => {
        const reflected = (target && target[DESIGN_TYPE_KEY])
            ?? readDesignType(target, propertyKey)
        const explicitBranch = metadata.branch !== undefined && metadata.branch !== false
        const isBranch = explicitBranch || isConstructable(metadata.childClass) || isConstructable(reflected)

        const bag = readDecoratorMeta<DecoratorBag>(COMMAND_ARG_DESC_KEY, target) ?? {}
        if (isBranch) {
            const branchOpts: BranchOptions =
                metadata.branch && typeof metadata.branch === 'object'
                    ? metadata.branch
                    : { description: metadata.description, displayHint: metadata.displayHint }
            const childClass = metadata.childClass ?? reflected as (new () => object) | undefined
            if (!childClass) {
                throw new Error(
                    `@CmdArgument on "${String(propertyKey)}": branch nodes require either a class-typed property ` +
                    `(emitMetadata + class type) or an explicit \`childClass\` option.`,
                )
            }
            bag[propertyKey] = { kind: 'branch', branch: branchOpts, childClass }
        } else {
            const leafOpts: LeafOptions & { type: LeafType } = {
                type: metadata.type ?? inferLeafType(reflected) ?? 'string',
                required: metadata.required,
                position: metadata.position,
                standalone: metadata.standalone,
                default: metadata.default,
                description: metadata.description,
                options: metadata.options,
                validator: metadata.validator,
                displayHint: metadata.displayHint,
            }
            bag[propertyKey] = { kind: 'leaf', leaf: leafOpts }
        }
        defineDecoratorMeta(COMMAND_ARG_DESC_KEY, target, bag)
    }
}

/* -- introspection ---------------------------------------------------- */

type DecoratorEntry =
    | { kind: 'leaf'; leaf: LeafOptions & { type: LeafType } }
    | { kind: 'branch'; branch: BranchOptions; childClass: new () => object }

type DecoratorBag = Record<string, DecoratorEntry>

/** Build an `OptionsTree` from a class decorated with `@CmdArgument`.
 *  The class's properties become children of a single `branch` node;
 *  branch-typed properties recurse into their inner classes. */
export function buildTreeFromClass(cls: new () => object): OptionsTree {
    return walkClass(cls)
}

function walkClass(cls: new () => object): OptionsTree {
    const bag = collectBag(cls)
    const children: Record<string, OptionsTree> = {}
    for (const [propertyKey, entry] of Object.entries(bag)) {
        if (entry.kind === 'leaf') {
            children[propertyKey] = leaf(entry.leaf) as LeafSpec
        } else {
            const sub = walkClass(entry.childClass) as OptionsTree
            // Inherit description/displayHint from the decorator if it
            // overrode them; otherwise keep what the inner class produced.
            children[propertyKey] = sub.node === 'branch' && (entry.branch.description || entry.branch.displayHint)
                ? branch(mapBranchChildren(sub), entry.branch)
                : sub
        }
    }
    return branch(children)
}

function mapBranchChildren(b: OptionsTree): Record<string, OptionsTree> {
    if (b.node !== 'branch') {
        throw new Error('mapBranchChildren: expected a branch node')
    }
    const out: Record<string, OptionsTree> = {}
    for (const [k, v] of b.children) out[k] = v
    return out
}

/** Walk the prototype chain so subclass overrides win. */
function collectBag(cls: new () => object): DecoratorBag {
    const merged: DecoratorBag = {}
    let proto = cls.prototype
    const stack: DecoratorBag[] = []
    while (proto && proto !== Object.prototype) {
        const bag = readDecoratorMeta<DecoratorBag>(COMMAND_ARG_DESC_KEY, proto)
        if (bag) stack.push(bag)
        proto = Object.getPrototypeOf(proto)
    }
    // Walk parent → child so child entries overwrite parent ones.
    for (let i = stack.length - 1; i >= 0; i--) {
        const bag = stack[i]
        for (const [k, v] of Object.entries(bag)) merged[k] = v
    }
    return merged
}

function readDesignType(target: unknown, propertyKey: string): unknown {
    // reflect-metadata exposes design:type via Reflect.getMetadata, which
    // is monkey-patched onto Reflect at module load. Using an indirection
    // so this file doesn't import reflect-metadata directly (the host app
    // does, before any decorators run).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = (Reflect as any)
    if (typeof r?.getMetadata === 'function') {
        return r.getMetadata(DESIGN_TYPE_KEY, target as object, propertyKey)
    }
    return undefined
}

function isConstructable(v: unknown): v is new () => object {
    if (typeof v !== 'function') return false
    // Primitive constructors (String / Number / Boolean) are constructable
    // but represent leaf types. Filter them out so a property declared as
    // `string` doesn't accidentally turn into a branch.
    return v !== String && v !== Number && v !== Boolean && v !== Object && v !== Array
}

function inferLeafType(reflected: unknown): LeafType | undefined {
    if (reflected === String) return 'string'
    if (reflected === Number) return 'number'
    if (reflected === Boolean) return 'bool'
    return undefined
}

/* -- legacy aliases (not deleted because internal callers still import) - */

export type CommandMetadata = Record<string, DecoratorEntry>
export type CommandArgumentKeyHolder = Record<string, unknown>

/** Re-export the validator type so consumers don't have to dig into tree.ts. */
export type { LeafValidator }
