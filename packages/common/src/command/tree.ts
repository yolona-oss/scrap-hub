/**
 * Canonical tree primitive for declaring a command's options.
 *
 * Every command's option surface is one `OptionsTree`: either a leaf
 * (a committable value) or a branch (a group whose children are
 * themselves trees). Branches' shape mirrors the parsed value's nested
 * object shape — `aiAgent: branch({ model: leaf({...}) })` parses to
 * `{ aiAgent: { model: string } }`.
 *
 * The tree is the single source of truth for:
 *  - what arguments a command accepts
 *  - their hierarchy (for drill-down UIs and dot-path completion)
 *  - per-leaf static option lists (the only kind that ships over the wire)
 *  - per-leaf validators (declared here, applied node-side; see Q4 in the
 *    design discussion — the hub does declarative checks only)
 *  - optional UI display hints (UIs decide how to render; absent hints
 *    fall back to "shape + leaf-type" defaults)
 */

/** Default delimiter for hierarchical paths, both in flatten/unflatten and
 *  in dot-path completion (CLI). `/` is preferred over `.` because realistic
 *  config values frequently contain dots (model names like `qwen2.5:7b`,
 *  version strings, API URLs). */
export const PAIR_PATH_DELIMITER = '/'

export type LeafType = 'string' | 'number' | 'bool'

/** Author-supplied hint for how a UI might want to render this node.
 *  UIs MAY ignore it — v1 UIs do, falling back to shape + type defaults.
 *  Reserved string union; new variants land via TS declaration merging
 *  if the framework grows additional UI conventions. */
export type DisplayHint =
    | 'select'
    | 'input'
    | 'fieldset'
    | 'tabs'
    | 'inline'
    | (string & {})

/** Validator runs node-side after the value crosses the wire. Returns
 *  `true` for valid; a `string` is treated as a human-readable reason
 *  and is sent back over the wire as a `ValidationFailed` event so the
 *  hub-side builder can re-prompt for just this leaf. `false` is treated
 *  as the generic message `"validation failed"`. */
export type LeafValidator = (raw: string) => true | false | string

export interface LeafSpec {
    readonly node: 'leaf'
    readonly type: LeafType
    readonly required: boolean
    /** Positional index, 1-based. `0` means non-positional (pair / standalone). */
    readonly position: number
    readonly standalone: boolean
    readonly default?: string
    readonly description: string
    /** Static option list. Resolved at manifest build time and shipped on
     *  the wire; consumers MUST commit one of these values when set. Empty
     *  array means "no fixed options — free-form input." */
    readonly options: readonly string[]
    readonly validator?: LeafValidator
    readonly displayHint?: DisplayHint
}

export interface BranchSpec {
    readonly node: 'branch'
    /** Map of child name → child tree. Order is preserved (Map insertion order)
     *  so UIs can render branches in declaration order. */
    readonly children: ReadonlyMap<string, OptionsTree>
    readonly description: string
    readonly displayHint?: DisplayHint
}

export type OptionsTree = LeafSpec | BranchSpec

/* -- builders --------------------------------------------------------- */

export interface LeafOptions {
    type?: LeafType
    required?: boolean
    position?: number
    standalone?: boolean
    default?: string
    description?: string
    options?: readonly string[]
    validator?: LeafValidator
    displayHint?: DisplayHint
}

export function leaf(opts: LeafOptions = {}): LeafSpec {
    return {
        node: 'leaf',
        type: opts.type ?? 'string',
        required: opts.required ?? false,
        position: opts.position ?? 0,
        standalone: opts.standalone ?? false,
        default: opts.default,
        description: opts.description ?? '',
        options: opts.options ?? [],
        validator: opts.validator,
        displayHint: opts.displayHint,
    }
}

export interface BranchOptions {
    description?: string
    displayHint?: DisplayHint
}

export function branch(
    children: Record<string, OptionsTree>,
    opts: BranchOptions = {},
): BranchSpec {
    const map = new Map<string, OptionsTree>()
    for (const [k, v] of Object.entries(children)) map.set(k, v)
    return {
        node: 'branch',
        children: map,
        description: opts.description ?? '',
        displayHint: opts.displayHint,
    }
}

/* -- type-level inference -------------------------------------------- */

type FromLeafType<T extends LeafType> =
    T extends 'string' ? string :
    T extends 'number' ? number :
    T extends 'bool' ? boolean :
    never

/** Map a tree literal to the parsed-value type. Optional fields fall out
 *  of `required: false` leaves; nested branches recurse. */
export type ParsedFromTree<T> =
    T extends BranchSpec
        ? { -readonly [K in BranchKeys<T>]: ParsedFromTree<BranchChild<T, K>> }
        : T extends LeafSpec
            ? FromLeafType<T['type']>
            : never

type BranchKeys<B extends BranchSpec> =
    B['children'] extends ReadonlyMap<infer K, OptionsTree> ? Extract<K, string> : never

// `K` is part of the public mapped-type signature even though the body
// only narrows by inferring V — keeping the parameter so call sites
// `BranchChild<B, K>` read naturally.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type BranchChild<B extends BranchSpec, _K extends string> =
    B['children'] extends ReadonlyMap<string, infer V>
        ? V extends OptionsTree ? V : never
        : never

/* -- flatten / unflatten --------------------------------------------- */

/** Walk every leaf in `tree`, yielding `[dotPath, leaf]`. Branches contribute
 *  no entry of their own — their structure is implicit in the path. */
export function* walkLeaves(
    tree: OptionsTree,
    path: string[] = [],
): Generator<{ path: string[]; pathKey: string; leaf: LeafSpec }> {
    if (tree.node === 'leaf') {
        yield { path, pathKey: path.join(PAIR_PATH_DELIMITER), leaf: tree }
        return
    }
    for (const [name, child] of tree.children) {
        yield* walkLeaves(child, [...path, name])
    }
}

/** Flatten a parsed nested object to a `Map<dotPath, string>`. Numbers
 *  and booleans coerce via `String()`; missing leaves are skipped. */
export function flattenValue(
    tree: OptionsTree,
    value: unknown,
): Map<string, string> {
    const out = new Map<string, string>()
    walk(tree, value, [], out)
    return out
}

function walk(tree: OptionsTree, value: unknown, path: string[], out: Map<string, string>): void {
    if (tree.node === 'leaf') {
        if (value === undefined || value === null) return
        out.set(path.join(PAIR_PATH_DELIMITER), String(value))
        return
    }
    if (typeof value !== 'object' || value === null) return
    const obj = value as Record<string, unknown>
    for (const [name, child] of tree.children) {
        walk(child, obj[name], [...path, name], out)
    }
}

/** Inverse of `flattenValue`. Walks the tree and pulls each leaf's value
 *  out of the flat map by dot-path, type-coercing per `LeafSpec.type`.
 *  Missing leaves remain `undefined`; type errors throw. */
export function unflattenValue(
    tree: OptionsTree,
    flat: ReadonlyMap<string, string>,
): unknown {
    const v = rebuild(tree, [], flat)
    // The root is always defined for callers — a branch root with no
    // populated children surfaces as `{}` rather than `undefined`, since
    // the caller expects the parsed-value object.
    if (v === undefined && tree.node === 'branch') return {}
    return v
}

function rebuild(tree: OptionsTree, path: string[], flat: ReadonlyMap<string, string>): unknown {
    if (tree.node === 'leaf') {
        const raw = flat.get(path.join(PAIR_PATH_DELIMITER))
        if (raw === undefined) return undefined
        return coerce(raw, tree.type)
    }
    const obj: Record<string, unknown> = {}
    let any = false
    for (const [name, child] of tree.children) {
        const v = rebuild(child, [...path, name], flat)
        if (v !== undefined) {
            obj[name] = v
            any = true
        }
    }
    // A branch with no populated children round-trips back to undefined,
    // matching `flattenValue`'s contract that missing leaves are skipped.
    // Top-level callers always get an object: `unflattenValue` re-wraps.
    return any ? obj : undefined
}

function coerce(raw: string, type: LeafType): unknown {
    if (type === 'string') return raw
    if (type === 'bool') {
        if (raw === 'true') return true
        if (raw === 'false') return false
        throw new TypeError(`expected boolean ('true'|'false'), got "${raw}"`)
    }
    // number
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new TypeError(`expected number, got "${raw}"`)
    return n
}

/** Locate a node in a tree by its dot-path. Returns `undefined` for
 *  unknown paths. The empty path returns the root. */
export function nodeAtPath(tree: OptionsTree, path: readonly string[]): OptionsTree | undefined {
    let node: OptionsTree = tree
    for (const segment of path) {
        if (node.node !== 'branch') return undefined
        const next = node.children.get(segment)
        if (!next) return undefined
        node = next
    }
    return node
}
