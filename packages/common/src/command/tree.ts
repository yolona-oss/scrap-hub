/**
 * Canonical tree primitive for declaring a command's arguments.
 *
 * Every command's argument surface is one `ArgTree`: either a leaf
 * (a committable value) or a branch (a group whose children are themselves
 * trees). Branches' shape mirrors the parsed value's nested object shape —
 * `aiAgent: argBranch({ model: argLeaf({...}) })` parses to `{ aiAgent: { model: string } }`.
 *
 * The tree is the single source of truth for:
 *  - what arguments a command accepts
 *  - their hierarchy (drill-down UIs and dot-path completion)
 *  - per-leaf static choice lists (the only kind that ships over the wire)
 *  - per-leaf validators (declared here, applied node-side)
 *  - per-leaf persistence (whether the framework reads/writes the layered store)
 *  - optional UI display hints
 */

export const ARG_PATH_DELIMITER = '/'

export type ArgValueType = 'string' | 'number' | 'bool'

export type DisplayHint =
    | 'select'
    | 'input'
    | 'fieldset'
    | 'tabs'
    | 'inline'
    | (string & {})

export type ArgValidator = (raw: string) => true | false | string

export interface ArgLeaf {
    readonly node: 'leaf'
    readonly type: ArgValueType
    readonly required: boolean
    /** Positional index, 1-based. `0` means non-positional (pair / standalone). */
    readonly position: number
    readonly standalone: boolean
    readonly default?: string
    readonly description: string
    /** Static choice list. Resolved at manifest build time and shipped on
     *  the wire; consumers MUST commit one of these values when set.
     *  Empty array means "no fixed choices — free-form input." */
    readonly choices: readonly string[]
    readonly validator?: ArgValidator
    readonly displayHint?: DisplayHint
    /** When true, the framework reads/writes this leaf's value to the
     *  layered account-session store. When false (default), the leaf is
     *  per-invocation only. */
    readonly persistent: boolean
}

export interface ArgBranch {
    readonly node: 'branch'
    readonly children: ReadonlyMap<string, ArgTree>
    readonly description: string
    readonly displayHint?: DisplayHint
}

export type ArgTree = ArgLeaf | ArgBranch

/* -- builders --------------------------------------------------------- */

export interface ArgLeafDef {
    type?: ArgValueType
    required?: boolean
    position?: number
    standalone?: boolean
    default?: string
    description?: string
    choices?: readonly string[]
    validator?: ArgValidator
    displayHint?: DisplayHint
    persistent?: boolean
}

export function argLeaf(opts: ArgLeafDef = {}): ArgLeaf {
    return {
        node: 'leaf',
        type: opts.type ?? 'string',
        required: opts.required ?? false,
        position: opts.position ?? 0,
        standalone: opts.standalone ?? false,
        default: opts.default,
        description: opts.description ?? '',
        choices: opts.choices ?? [],
        validator: opts.validator,
        displayHint: opts.displayHint,
        persistent: opts.persistent ?? false,
    }
}

export interface ArgBranchDef {
    description?: string
    displayHint?: DisplayHint
}

export function argBranch(
    children: Record<string, ArgTree>,
    opts: ArgBranchDef = {},
): ArgBranch {
    const map = new Map<string, ArgTree>()
    for (const [k, v] of Object.entries(children)) map.set(k, v)
    return {
        node: 'branch',
        children: map,
        description: opts.description ?? '',
        displayHint: opts.displayHint,
    }
}

/* -- type-level inference -------------------------------------------- */

type FromArgValueType<T extends ArgValueType> =
    T extends 'string' ? string :
    T extends 'number' ? number :
    T extends 'bool' ? boolean :
    never

export type ParsedFromArgTree<T> =
    T extends ArgBranch
        ? { -readonly [K in BranchKeys<T>]: ParsedFromArgTree<BranchChild<T, K>> }
        : T extends ArgLeaf
            ? FromArgValueType<T['type']>
            : never

type BranchKeys<B extends ArgBranch> =
    B['children'] extends ReadonlyMap<infer K, ArgTree> ? Extract<K, string> : never

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type BranchChild<B extends ArgBranch, _K extends string> =
    B['children'] extends ReadonlyMap<string, infer V>
        ? V extends ArgTree ? V : never
        : never

/* -- flatten / unflatten --------------------------------------------- */

export function* walkArgLeaves(
    tree: ArgTree,
    path: string[] = [],
): Generator<{ path: string[]; pathKey: string; leaf: ArgLeaf }> {
    if (tree.node === 'leaf') {
        yield { path, pathKey: path.join(ARG_PATH_DELIMITER), leaf: tree }
        return
    }
    for (const [name, child] of tree.children) {
        yield* walkArgLeaves(child, [...path, name])
    }
}

export function flattenArgs(
    tree: ArgTree,
    value: unknown,
): Map<string, string> {
    const out = new Map<string, string>()
    walk(tree, value, [], out)
    return out
}

function walk(tree: ArgTree, value: unknown, path: string[], out: Map<string, string>): void {
    if (tree.node === 'leaf') {
        if (value === undefined || value === null) return
        out.set(path.join(ARG_PATH_DELIMITER), String(value))
        return
    }
    if (typeof value !== 'object' || value === null) return
    const obj = value as Record<string, unknown>
    for (const [name, child] of tree.children) {
        walk(child, obj[name], [...path, name], out)
    }
}

export function unflattenArgs(
    tree: ArgTree,
    flat: ReadonlyMap<string, string>,
): unknown {
    const v = rebuild(tree, [], flat)
    if (v === undefined && tree.node === 'branch') return {}
    return v
}

function rebuild(tree: ArgTree, path: string[], flat: ReadonlyMap<string, string>): unknown {
    if (tree.node === 'leaf') {
        const raw = flat.get(path.join(ARG_PATH_DELIMITER))
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
    return any ? obj : undefined
}

function coerce(raw: string, type: ArgValueType): unknown {
    if (type === 'string') return raw
    if (type === 'bool') {
        if (raw === 'true') return true
        if (raw === 'false') return false
        throw new TypeError(`expected boolean ('true'|'false'), got "${raw}"`)
    }
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new TypeError(`expected number, got "${raw}"`)
    return n
}

export function argNodeAtPath(tree: ArgTree, path: readonly string[]): ArgTree | undefined {
    let node: ArgTree = tree
    for (const segment of path) {
        if (node.node !== 'branch') return undefined
        const next = node.children.get(segment)
        if (!next) return undefined
        node = next
    }
    return node
}
