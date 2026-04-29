# Arg vocabulary unification — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse `config`+`params` slices into a single `args` tree with a per-leaf `persistent` flag, rename the declaration vocabulary onto a single `Arg` root, kill the `options` overload, and rename `messages` → `intercom`.

**Architecture:** Phased mechanical-rename across 9 packages, then targeted TDD for the four structural changes (the `config`+`params` merge, the new `persistent` flag, the Mongo `data.config` → `data.args` migration, and the `/sargs` filter). Single PR, hard cut, no aliases.

**Tech Stack:** TypeScript, npm workspaces, Jest, gRPC (proto3), MongoDB/Mongoose. Source spec: `docs/superpowers/specs/2026-04-29-arg-vocabulary-unification-design.md`.

---

## Task layout

The plan has three phases:

- **Phase 1 — Foundation renames in `@cmd-hub/common`** (Tasks 1–4). Tree primitives, decorator, service-decorator payload, slice property names. After this phase, `tsc --build` will fail in every other package; that's expected and is what drives Phase 2.
- **Phase 2 — Mechanical rename across remaining packages** (Tasks 5–10). One package per task. Each task is a full inventory: what to rename, the exact symbols, the test command, and the expected zero-failure outcome.
- **Phase 3 — Structural changes** (Tasks 11–15). The `persistent` flag, the merged-args bootstrap in `BaseCommandService.initSession()`, the Mongo migration hook, the `/sargs` filter, the e2e gate.

Each phase ends with a green `npm run build` and `npm test` checkpoint.

## Notation

- `Path:line` references are read-only signposts to help locate code, not always the literal edit point.
- "Run tests" steps state the exact command and the expected pass/fail outcome.
- Code blocks in steps show the **final** state after the edit, unless the step is a delta (then "before" / "after" is shown).

---

## Phase 1 — Foundation in `@cmd-hub/common`

### Task 1: Rename tree primitives in `tree.ts`

**Files:**
- Modify: `packages/common/src/command/tree.ts`
- Modify: `packages/common/src/command/__tests__/cmd-one-shot.test.ts` (depends on the renames)

This task introduces the new `Arg*` type names while keeping the discriminator strings (`node: 'leaf' | 'branch'`) unchanged. After this task `@cmd-hub/common` will not yet build because consumers still reference the old names — that's the next task.

- [ ] **Step 1: Apply the rename in `tree.ts`**

Open `packages/common/src/command/tree.ts` and replace the file's contents with the same logic but renamed. The discriminator string values (`'leaf'`, `'branch'`) stay; only the type names change. Field rename: `LeafSpec.options` → `ArgLeaf.choices`. Constant rename: `PAIR_PATH_DELIMITER` → `ARG_PATH_DELIMITER`. Function renames: `walkLeaves` → `walkArgLeaves`, `flattenValue` → `flattenArgs`, `unflattenValue` → `unflattenArgs`, `nodeAtPath` → `argNodeAtPath`. Builders: `leaf()` → `argLeaf()`, `branch()` → `argBranch()`. Type renames per the spec.

```typescript
// packages/common/src/command/tree.ts
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
```

- [ ] **Step 2: Update tree.ts re-exports / index**

If `packages/common/src/command/index.ts` re-exports the old names, replace them with the new ones in this same step. Run:

```bash
grep -nE 'OptionsTree|LeafSpec|BranchSpec|LeafType|LeafValidator|LeafOptions|BranchOptions|walkLeaves|flattenValue|unflattenValue|nodeAtPath|PAIR_PATH_DELIMITER|^\s*leaf\b|^\s*branch\b' packages/common/src/command/index.ts || echo "no matches"
```

For every match, swap to the new symbol. The re-exports should now read:

```typescript
// excerpt — keep the rest of the file as-is
export {
    ARG_PATH_DELIMITER,
    type ArgValueType,
    type DisplayHint,
    type ArgValidator,
    type ArgLeaf,
    type ArgBranch,
    type ArgTree,
    type ArgLeafDef,
    type ArgBranchDef,
    argLeaf,
    argBranch,
    walkArgLeaves,
    flattenArgs,
    unflattenArgs,
    argNodeAtPath,
    type ParsedFromArgTree,
} from './tree'
```

- [ ] **Step 3: Update `tree.ts` tests if they exist**

Run:

```bash
ls packages/common/src/command/__tests__/
```

If there is a `tree.test.ts`, open it and swap every old symbol for the new one. The test logic does not change.

- [ ] **Step 4: Run the common-package build to confirm `tree.ts` is internally consistent**

```bash
cd packages/common && npx tsc --build
```

Expected: failures only in *consumer* files within `@cmd-hub/common` (e.g. `argument-decorator.ts`, `cmd-one-shot.ts`) — not in `tree.ts` itself. If `tree.ts` has its own errors, fix them inline before proceeding.

- [ ] **Step 5: Commit**

```bash
git add packages/common/src/command/tree.ts packages/common/src/command/index.ts packages/common/src/command/__tests__/
git commit -m "refactor(common): rename tree primitives onto Arg root

OptionsTree → ArgTree, LeafSpec → ArgLeaf, BranchSpec → ArgBranch,
LeafSpec.options → ArgLeaf.choices, walkLeaves/flattenValue/etc. →
walkArgLeaves/flattenArgs/etc. ArgLeaf gains a persistent: boolean
field (default false; behavior wired in Phase 3). Discriminator
strings ('leaf'|'branch') unchanged."
```

---

### Task 2: Rename `@CmdArgument` → `@CmdArg` and update the decorator

**Files:**
- Rename: `packages/common/src/command/argument-decorator.ts` → `packages/common/src/command/arg-decorator.ts`
- Modify: `packages/common/src/command/arg-proxy.ts`
- Modify: `packages/common/src/command/index.ts`

- [ ] **Step 1: Rename the file**

```bash
git mv packages/common/src/command/argument-decorator.ts packages/common/src/command/arg-decorator.ts
```

- [ ] **Step 2: Apply the renames inside the new file**

In `packages/common/src/command/arg-decorator.ts`:

- Symbol renames: `CmdArgument` → `CmdArg`, `CmdArgumentDef` → `ArgDef`, `COMMAND_ARG_DESC_KEY` → `CMD_ARG_META_KEY`, `buildTreeFromClass` → `buildArgTreeFromClass`, `LeafOptions` → `ArgLeafDef`, `BranchOptions` → `ArgBranchDef`, `LeafSpec` → `ArgLeaf`, `OptionsTree` → `ArgTree`, `LeafType` → `ArgValueType`, `LeafValidator` → `ArgValidator`, `leaf` builder → `argLeaf`, `branch` builder → `argBranch`.
- The decorator now forwards a `persistent` flag through its `LeafOptions` / `ArgLeafDef`.
- The doc-block at the top of the file is updated to reference the new names.

```typescript
// packages/common/src/command/arg-decorator.ts
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
```

- [ ] **Step 3: Update `arg-proxy.ts`**

Open `packages/common/src/command/arg-proxy.ts`. Replace every old symbol with its new name (use the symbol mapping in the table above). The file's logic does not change — only the imports and references.

- [ ] **Step 4: Update `packages/common/src/command/index.ts`**

The decorator file moved and the symbol names changed. Replace every reference to the old names with the new ones, including the file path:

```typescript
// excerpt
export { CmdArg, ArgDef, CMD_ARG_META_KEY, buildArgTreeFromClass } from './arg-decorator'
```

- [ ] **Step 5: Update `cmd-one-shot.ts`**

Open `packages/common/src/command/cmd-one-shot.ts`. Replace `@CmdArgument` references in comments, swap `OptionsTree` → `ArgTree`, `unflattenValue` → `unflattenArgs`, `buildTreeFromClass` → `buildArgTreeFromClass`. The decorator name change does not affect `CmdOneShot` itself; `CmdOneShotMeta.argsClass` keeps its name.

- [ ] **Step 6: Update `service-decorator.ts` (partial — leave the payload-shape change for Task 3)**

Just swap `@CmdArgument` mentions in comments to `@CmdArg`. The `config` / `params` / `messages` field names on `CmdServiceMeta` stay for now; Task 3 changes the payload shape.

- [ ] **Step 7: Build to verify the foundation rename**

```bash
cd packages/common && npx tsc --build 2>&1 | head -40
```

Expected: errors are confined to `service/service-data.ts`, `service/base-command-service.ts`, `service/service-store.ts`, and tests under `service/__tests__/` — i.e., the files Tasks 3–4 will fix.

- [ ] **Step 8: Update the cmd-one-shot test**

Open `packages/common/src/command/__tests__/cmd-one-shot.test.ts`. Replace `@CmdArgument` with `@CmdArg` and the imports from `argument-decorator` to `arg-decorator`. Run:

```bash
cd packages/common && npx jest src/command/__tests__/cmd-one-shot.test.ts
```

Expected: PASS (the rename is mechanical; logic is unchanged).

- [ ] **Step 9: Commit**

```bash
git add packages/common/src/command/
git commit -m "refactor(common): rename @CmdArgument → @CmdArg

argument-decorator.ts → arg-decorator.ts, COMMAND_ARG_DESC_KEY →
CMD_ARG_META_KEY, buildTreeFromClass → buildArgTreeFromClass.
ArgLeafDef gains an optional persistent flag (wired in Phase 3)."
```

---

### Task 3: Reshape `@CmdService` payload and rename slice classes

**Files:**
- Modify: `packages/common/src/command/service-decorator.ts`
- Modify: `packages/common/src/service/service-data.ts`

This is the moment the service-decorator payload changes from `{ config, params, messages }` to `{ args, intercom }`, and `CmdServiceData` field names change.

- [ ] **Step 1: Apply rename to `service-decorator.ts`**

```typescript
// packages/common/src/command/service-decorator.ts
import {
    BaseCommandIdentityWithRequires,
    assertCommandIdentity,
    assertRequires,
} from './identity'
import { defineDecoratorMeta, readDecoratorMeta, makeMetaKey } from './metadata'

const META_KEY = makeMetaKey('CmdService')

/** Zero-arg data-class constructor for the args/intercom buckets declared
 *  on `@CmdService`. Walked by `buildArgTreeFromClass` to produce the
 *  leaf/branch tree that rides over the wire. */
export type CmdDataClass = new () => object

export interface CmdServiceMeta extends BaseCommandIdentityWithRequires {
    args: CmdDataClass
    intercom: CmdDataClass
}

function assertServiceMeta(meta: CmdServiceMeta): void {
    assertCommandIdentity(meta, '@CmdService')
    assertRequires(meta.requires, '@CmdService')
    if (!meta.args) throw new Error('@CmdService: args class is required')
    if (!meta.intercom) throw new Error('@CmdService: intercom class is required')
}

export function CmdService(meta: CmdServiceMeta): ClassDecorator {
    return (target) => {
        assertServiceMeta(meta)
        defineDecoratorMeta(META_KEY, target, meta)
    }
}

export function getCmdServiceMeta(cls: object): CmdServiceMeta | null {
    return readDecoratorMeta<CmdServiceMeta>(META_KEY, cls)
}
```

- [ ] **Step 2: Rewrite `service-data.ts` to merge `config`+`params` and rename `messages`+`runtimeState`**

Two structural changes here: (a) `GlobalServiceConfig` is deleted (it was empty), `GlobalServiceParam` becomes `GlobalServiceArgs` and absorbs the four ephemeral flags; (b) `CmdServiceData` now has `args` (replaces `config`+`params`), `intercom` (was `messages`), `state` (was `runtimeState`).

```typescript
// packages/common/src/service/service-data.ts
import { CmdArg } from "../command";
import { DEFAULT_ACCOUNT_SESSION_NAME } from "./service-store";

export class GlobalServiceArgs {
    @CmdArg({
        required: false,
        description: "Session id to restore state from."
    })
    sessionId?: string

    @CmdArg({
        required: false,
        standalone: true,
        description: "Disable auto-dashboard for this service"
    })
    noDashboard?: string

    @CmdArg({
        required: false,
        standalone: true,
        description: "Skip per-account/session arg overlays for this run; use built-in defaults + explicit args only. Saved values are NOT modified.",
    })
    noCache?: string

    @CmdArg({
        required: false,
        standalone: true,
        description: "Skip the builder. Run immediately using saved session/state data merged with any typed args. Falls back to the builder when required args are missing.",
    })
    now?: string
}

export class GlobalServiceIntercom {
    @CmdArg({
        required: false,
        description: "Echo message",
        default: "echo",
    })
    echo?: string
}

/**
 * Holder for the three data slices a service operates on:
 *
 * - `args`     — merged effective arguments. Persistent leaves were
 *                read from defaults ← account ← session ← input;
 *                ephemeral leaves came straight from input.
 * - `intercom` — args for in-band reverse-channel messages
 *                (pause/resume/stop/custom action ids).
 * - `state`    — resumable state the service writes during a run.
 */
export class CmdServiceData<
        TArgs extends Object = GlobalServiceArgs,
        TIntercom extends Object = GlobalServiceIntercom,
        TState extends Object = {}
    >
{
    constructor(
        public args: TArgs,
        public intercom: TIntercom,
        public sessionId: string = DEFAULT_ACCOUNT_SESSION_NAME,
        public state: TState = {} as TState,
    ) { }

    /** Read-side alias for {@link args}. */
    get effectiveArgs(): TArgs { return this.args }
}
```

- [ ] **Step 3: Run the common-package build**

```bash
cd packages/common && npx tsc --build 2>&1 | tail -40
```

Expected: errors confined to `service/base-command-service.ts` and `service/__tests__/base-command-service.test.ts` (Task 4) and `service/service-store.ts` (Task 4 also — `replaceConfig` rename).

- [ ] **Step 4: Commit**

```bash
git add packages/common/src/command/service-decorator.ts packages/common/src/service/service-data.ts
git commit -m "refactor(common): merge config+params into args slice; rename messages+runtimeState

@CmdService payload is now { args, intercom } (was { config, params,
messages }). CmdServiceData has fields args/intercom/state (was
config/params/messages/runtimeState). GlobalServiceConfig (empty) is
deleted; GlobalServiceParam → GlobalServiceArgs absorbs the four
ephemeral flags; GlobalServiceMessages → GlobalServiceIntercom."
```

---

### Task 4: Update `BaseCommandService` and `IServiceStore` to the new vocabulary (rename only — bootstrap-merge change comes in Phase 3)

**Files:**
- Modify: `packages/common/src/service/service-store.ts`
- Modify: `packages/common/src/service/base-command-service.ts`
- Modify: `packages/common/src/service/__tests__/base-command-service.test.ts`
- Modify: `packages/common/src/service/service-context.ts` (any `config` field)

This task does the *rename* portion only. The behavioral change to `initSession()` (the persistent-flag-driven merge) lands in Task 11. Here we keep the same logic but with new names: `data.config` → `data.args` (ephemeral leaves still riding alongside persistent ones in the same map, as today), `data.messages` → `data.intercom`, `data.runtimeState` → `data.state`. The session-layer key `'config'` becomes `'args'`, etc.

- [ ] **Step 1: Update `IServiceAccountLayer.replaceConfig` → `replaceArgs`**

Open `packages/common/src/service/service-store.ts:30`. Rename the method:

```typescript
export interface IServiceAccountLayer {
    readonly data: Record<string, unknown>
    setField(path: string, value: unknown): Promise<void>
    /** Replace the full `data.args` object and save. */
    replaceArgs(args: Record<string, unknown>): Promise<void>
}
```

Update the doc-block at the top of the file (the second paragraph mentions "config" four times — replace with "args").

- [ ] **Step 2: Rename slice references in `base-command-service.ts`**

Open `packages/common/src/service/base-command-service.ts`. Apply the renames:

- `SESSION_CONFIG_KEY = 'config'` → `SESSION_ARGS_KEY = 'args'`
- `SESSION_RUNTIME_STATE_KEY = 'runtimeState'` → `SESSION_STATE_KEY = 'state'`
- Imports: `GlobalServiceConfig`, `GlobalServiceParam`, `GlobalServiceMessages` → `GlobalServiceArgs`, `GlobalServiceIntercom`
- `g_conf`, `g_param`, `g_msgs` locals → drop `g_conf` (no `GlobalServiceConfig` exists), keep one `g_args` (= `new GlobalServiceArgs`) and one `g_intercom` (= `new GlobalServiceIntercom`)
- `this.data.config` → `this.data.args`; `this.data.params` → fold into `this.data.args`; `this.data.messages` → `this.data.intercom`; `this.data.runtimeState` → `this.data.state`
- Tree accessor methods: `configTree()` + `paramsTree()` → single `argsTree()` (returns the merged `GlobalServiceArgs ⊕ this.data.args` tree). `messagesTree()` → `intercomTree()`.
- `setConfigValue` → `setArgValue`. `setRuntimeStateValue` → `setStateValue`. `setRuntimeState` → `setState`.

The `initSession()` flow keeps the same merge order (defaults ← account ← session ← input) for now, but reads/writes from `data.args` instead of `data.config`. The four standalone flags (`sessionId`, `noDashboard`, `noCache`, `now`) — now decorated leaves on `GlobalServiceArgs` — sit in the same `data.args` map as the persistent leaves but are *not yet* filtered out of the layered merge. **That filtering is Task 11.**

The full file body should look like this after editing (showing the changed sections; unchanged sections retain their bodies):

```typescript
// packages/common/src/service/base-command-service.ts
// imports — note removed GlobalServiceConfig
import {
    GlobalServiceArgs,
    GlobalServiceIntercom,
    CmdServiceData,
} from "./service-data"

// ... rest of imports unchanged ...

const SESSION_ARGS_KEY = 'args'
const SESSION_STATE_KEY = 'state'

function joinFieldPath(slice: string, sub: string): string {
    return sub.length > 0 ? `${slice}.${sub}` : slice
}

function isFlagSet(v: unknown): boolean {
    return v === true || v === 'true'
}

function mergeTrees(globalCls: new () => object, userInstance: object): ArgBranch {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const userCls: (new () => object) | undefined = (userInstance as any)?.constructor
    const globalTree = buildArgTreeFromClass(globalCls)
    const userTree = userCls ? buildArgTreeFromClass(userCls) : argBranch({})
    if (globalTree.node !== 'branch' || userTree.node !== 'branch') {
        throw new Error('mergeTrees: both classes must produce branch roots')
    }
    const merged: Record<string, ArgTree> = {}
    for (const [k, v] of globalTree.children) merged[k] = v
    for (const [k, v] of userTree.children) merged[k] = v
    return argBranch(merged) as ArgBranch
}

// ... constructor: initialize data.args from defaultData.args + new GlobalServiceArgs;
//     data.intercom from defaultData.intercom + new GlobalServiceIntercom.
//     Drop the old config/params/messages assignments.

constructor(
    protected userId: string,
    private defaultData: ServiceDataType,
    protected inputServiceData: Partial<ServiceDataType>,
    public readonly name: string = BLANK_SERVICE_NAME,
) {
    super()
    this.data = defaultData
    const g_args     = new GlobalServiceArgs
    const g_intercom = new GlobalServiceIntercom
    this.data.args     = merge(this.data.args, g_args)
    this.data.intercom = merge(this.data.intercom, g_intercom)
}

// argsTree() replaces configTree() + paramsTree()
argsTree(): ArgTree {
    return mergeTrees(GlobalServiceArgs, this.data.args)
}

intercomTree(): ArgTree {
    return mergeTrees(GlobalServiceIntercom, this.data.intercom)
}

// initSession — RENAME ONLY in this task (no filtering change yet)
async initSession() {
    const inputData = this.inputServiceData
    const defaultData = this.defaultData

    // sessionId is read from inputData.args (was inputData.params).
    // The shorthand 's' alias was already supported on the old params class
    // and is preserved here as a fallback lookup.
    const inputArgs = (inputData.args ?? {}) as Record<string, unknown>
    const _session_id: string =
        (inputArgs as any)?.s ||
        (inputArgs as any)?.sessionId ||
        DEFAULT_ACCOUNT_SESSION_NAME
    this.data.sessionId = _session_id
    this.data.args = { ...this.data.args, ...inputArgs } as any

    const { sessionLayerData, accountLayerData, sessionLayer } = await this.retrieveAccountData(true)

    const noCache = isFlagSet(inputArgs['noCache'])

    const accountArgs = noCache ? {} : ((accountLayerData[SESSION_ARGS_KEY] ?? {}) as Record<string, unknown>)
    const sessionArgs = noCache ? {} : ((sessionLayerData[SESSION_ARGS_KEY] ?? {}) as Record<string, unknown>)

    const aArgs = {
        ...defaultData.args,
        ...accountArgs,
        ...sessionArgs,
        ...inputArgs,
    }

    const existingState = (sessionLayerData[SESSION_STATE_KEY] ?? {}) as Record<string, unknown>
    let aState: Record<string, unknown> = existingState
    const initState = !aState || Object.keys(aState).length === 0
    if (initState) {
        aState = {
            ...defaultData.state,
            ...((inputData as any).state ?? {}),
        } as Record<string, unknown>
    }

    if (!noCache) {
        await sessionLayer.setField(SESSION_ARGS_KEY, aArgs as Record<string, unknown>)
        if (initState) {
            await sessionLayer.setField(SESSION_STATE_KEY, aState)
        }
    }

    this.data = {
        args: aArgs,
        state: aState,
        sessionId: sessionLayer.name,
        intercom: defaultData.intercom,
    } as ServiceDataType
}

// setConfigValue → setArgValue
protected async setArgValue(path: string, value: any) {
    const { sessionLayer } = await this.retrieveAccountData()
    await sessionLayer.setField(joinFieldPath(SESSION_ARGS_KEY, path), value)
}

// setRuntimeStateValue → setStateValue
protected async setStateValue(path: string, value: any) {
    const { sessionLayer } = await this.retrieveAccountData()
    await sessionLayer.setField(joinFieldPath(SESSION_STATE_KEY, path), value)
}

// setRuntimeState → setState
protected async setState(updates: Record<string, unknown>): Promise<void> {
    const { sessionLayer } = await this.retrieveAccountData()
    const prefixed: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(updates)) {
        prefixed[joinFieldPath(SESSION_STATE_KEY, k)] = v
    }
    await sessionLayer.setFields(prefixed)
}

// getServiceContext: rename config → args in the returned object
protected getServiceContext(): ServiceContext {
    return {
        userId: this.userId,
        serviceName: this.name,
        sessionId: this.data.sessionId,
        args: this.data.args as Record<string, any>,
        events: {
            liveLog: (lines) => this.emit('liveLog', lines),
        },
    }
}
```

- [ ] **Step 3: Update `service-context.ts`**

Open `packages/common/src/service/service-context.ts`. Rename the `config` field on `ServiceContext` to `args`. (If the type also has a `params` field, fold it into `args` per the merge.)

- [ ] **Step 4: Update `service-store.ts` doc-blocks**

Same file as Step 1; double-check the file's *header* docblock (lines 1–22 of the original) which mentions "config" six times. Each "config" should become "args"; the `replaceConfig` reference in the header should become `replaceArgs`.

- [ ] **Step 5: Update `base-command-service.test.ts`**

Open `packages/common/src/service/__tests__/base-command-service.test.ts`. Replace every reference to the old slice names:

- `data.config` → `data.args`
- `sessionLayer.data.config` → `sessionLayer.data.args` (the layer key is `'args'` now)
- `accountLayer.data.config` → `accountLayer.data.args`
- `GlobalServiceConfig` references in the `TestServiceData` class → drop (replaced by `GlobalServiceArgs`)
- `GlobalServiceParam` → `GlobalServiceArgs`
- `GlobalServiceMessages` → `GlobalServiceIntercom`
- Imports updated to match.

The assertion logic does not change. `opts.sessionConfig` test fixture rename: `opts.sessionArgs`.

- [ ] **Step 6: Run the common-package test suite**

```bash
cd packages/common && npx jest
```

Expected: **PASS** all 94 tests. If anything fails, the failure is a missed rename — fix it inline before continuing.

- [ ] **Step 7: Build the common package**

```bash
cd packages/common && npx tsc --build
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add packages/common/src/service/ packages/common/src/__mocks__/
git commit -m "refactor(common): rename slice fields in BaseCommandService + tests

data.config + data.params → data.args, data.messages → data.intercom,
data.runtimeState → data.state. Tree accessors collapsed:
configTree+paramsTree → argsTree, messagesTree → intercomTree.
Setter renames: setConfigValue → setArgValue, setRuntimeStateValue →
setStateValue, setRuntimeState → setState. Session-layer keys
SESSION_CONFIG_KEY → SESSION_ARGS_KEY, SESSION_RUNTIME_STATE_KEY →
SESSION_STATE_KEY. IServiceAccountLayer.replaceConfig → replaceArgs.
Bootstrap merge logic unchanged in this task — Task 11 wires the
persistent-flag filter."
```

Phase 1 is complete: `@cmd-hub/common` builds and tests green.

---

## Phase 2 — Mechanical rename across remaining packages

Each task in this phase is one package. The structure is the same: identify call-sites with `grep`, swap symbols, run the package's tsc + jest, commit.

The full symbol mapping (apply across all files):

```
─── decorator + tree types ─────────────────────────────────────
@CmdArgument → @CmdArg
CmdArgumentDef → ArgDef
OptionsTree → ArgTree
LeafSpec → ArgLeaf
BranchSpec → ArgBranch
LeafOptions → ArgLeafDef
BranchOptions → ArgBranchDef
LeafType → ArgValueType
LeafValidator → ArgValidator
LeafSpec.options → ArgLeaf.choices
COMMAND_ARG_DESC_KEY → CMD_ARG_META_KEY
PAIR_PATH_DELIMITER → ARG_PATH_DELIMITER
buildTreeFromClass → buildArgTreeFromClass
walkLeaves → walkArgLeaves
flattenValue → flattenArgs
unflattenValue → unflattenArgs
nodeAtPath → argNodeAtPath
leaf() → argLeaf()
branch() → argBranch()

─── service-decorator payload ──────────────────────────────────
@CmdService({ config, params, messages }) → @CmdService({ args, intercom })
CmdServiceMeta.config / .params / .messages → .args / .intercom

─── slice classes ──────────────────────────────────────────────
GlobalServiceConfig → (deleted)
GlobalServiceParam → GlobalServiceArgs
GlobalServiceMessages → GlobalServiceIntercom

─── data slices ────────────────────────────────────────────────
data.config → data.args
data.params → data.args (folded)
data.messages → data.intercom
data.runtimeState → data.state

─── method renames ─────────────────────────────────────────────
configTree() → argsTree()
paramsTree() → (folded into argsTree())
messagesTree() → intercomTree()
setConfigValue → setArgValue
setRuntimeStateValue → setStateValue
setRuntimeState → setState
replaceConfig → replaceArgs
```

Plus, in user-facing strings and slash-command names:

- `/sconfig` → `/sargs`
- Wire prefix paths in `desc-compiler` / `dispatcher`: `config/`, `params/` → `args/`; `messages/` → `intercom/`.

### Task 5: Rename in `packages/transport`

**Files:**
- Modify: `packages/transport/src/grpc/protos/cmd_node.proto`
- Modify: any tree-codec files (search target below)
- Modify: tests

The proto already calls the wire field `args` at the `InvokeStart` level (line 183) — that's good. The change here is to (a) rename the proto's `LeafNode.options` to `choices` (line 85) so the wire field name matches the new vocabulary, and (b) optionally rename the `CommandOptionsTree` / `LeafNode` / `BranchNode` proto messages to `CommandArgTree` / `ArgLeafNode` / `ArgBranchNode`.

- [ ] **Step 1: Find every reference to the old symbols in transport**

```bash
grep -rnE 'OptionsTree|LeafSpec|BranchSpec|LeafType|LeafValidator|LeafOptions|BranchOptions|walkLeaves|flattenValue|unflattenValue|nodeAtPath|@CmdArgument|CmdArgumentDef|buildTreeFromClass|GlobalServiceConfig|GlobalServiceParam|GlobalServiceMessages|data\.config\b|data\.params\b|data\.messages\b|data\.runtimeState\b|configTree|paramsTree|messagesTree|setConfigValue|setRuntimeState\b|replaceConfig' packages/transport/src
```

Save the output. Every line is a rename target.

- [ ] **Step 2: Edit the proto**

Open `packages/transport/src/grpc/protos/cmd_node.proto`:

1. Line 61: `CommandOptionsTree options = 5;` — rename the message type to `CommandArgTree` and the field stays `options` for now (we'll rename the field name as well in this step). Final: `CommandArgTree args = 5;`.
2. Lines 70–75: rename message `CommandOptionsTree` → `CommandArgTree`, with `oneof node { ArgLeafNode leaf = 1; ArgBranchNode branch = 2; }`.
3. Lines 76–89: rename `LeafNode` → `ArgLeafNode`. Field rename inside: `repeated string options = 6;` → `repeated string choices = 6;`. Add a new field `bool persistent = 9;` for the persistent flag (used at manifest-publish time so the hub can render the persistent/ephemeral split in `/sargs`).
4. Lines 90–97: rename `BranchNode` → `ArgBranchNode`.

Final excerpt:

```proto
message Command {
  string name = 1;
  string compatibility_id = 2;
  string version = 3;
  string description = 4;
  // Single root tree describing every argument this command accepts.
  CommandArgTree args = 5;
  repeated string aliases = 6;
  repeated string requires = 7;
}
message CommandArgTree {
  oneof node {
    ArgLeafNode leaf = 1;
    ArgBranchNode branch = 2;
  }
}
message ArgLeafNode {
  // 'string' | 'number' | 'bool'
  string type = 1;
  bool required = 2;
  uint32 position = 3;
  bool standalone = 4;
  string default = 5;
  // Static choice list. Empty means free-form input.
  repeated string choices = 6;
  string description = 7;
  string display_hint = 8;
  // Whether the framework reads/writes this leaf to the layered store.
  bool persistent = 9;
}
message ArgBranchNode {
  map<string, CommandArgTree> children = 1;
  string description = 2;
  string display_hint = 3;
}
```

- [ ] **Step 3: Regenerate proto bindings**

```bash
cd packages/transport && npm run build  # or whatever generates ts from proto
```

If the build script doesn't run protoc, find the generator command in `packages/transport/package.json` and run it. Generated files land in `packages/transport/src/grpc/generated/`.

- [ ] **Step 4: Update tree-codec files**

Find them:

```bash
grep -rnE 'treeToProto|protoToTree' packages/transport/src
```

Apply the symbol swaps on every match. Likely files: `packages/transport/src/grpc/tree-codec.ts` (or wherever `treeToProto` lives), and any `aggregator.ts`, `manifest-aggregator.ts`, `command-pool.ts`. The codec internals walk `ArgLeaf`/`ArgBranch` instead of `LeafSpec`/`BranchSpec` and use `.choices` instead of `.options`. **Add reading/writing of the new `persistent` field** so it survives the round-trip.

- [ ] **Step 5: Run transport tests**

```bash
cd packages/transport && npx jest
```

Expected: PASS (the codec round-trip tests still hold; tests that asserted on old field names need their assertions updated).

If a test fails because it referenced `LeafSpec.options`, swap to `ArgLeaf.choices` in the test. If the round-trip drops the `persistent` field, fix the codec to forward it.

- [ ] **Step 6: Build transport**

```bash
cd packages/transport && npx tsc --build
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/transport/
git commit -m "refactor(transport): rename proto messages + fields to Arg vocabulary

CommandOptionsTree → CommandArgTree, LeafNode → ArgLeafNode,
BranchNode → ArgBranchNode. Field renames: LeafNode.options →
ArgLeafNode.choices. New field: ArgLeafNode.persistent (bool).
Generated bindings + tree-codec updated; round-trip tests cover
the new persistent field."
```

---

### Task 6: Rename in `packages/core`

**Files:**
- Many. Use the file-list at the bottom of this task as the working set.

- [ ] **Step 1: Inventory call-sites**

```bash
grep -rnE 'OptionsTree|LeafSpec|BranchSpec|LeafType|LeafValidator|LeafOptions|BranchOptions|walkLeaves|flattenValue|unflattenValue|nodeAtPath|@CmdArgument\b|CmdArgumentDef|buildTreeFromClass|GlobalServiceConfig|GlobalServiceParam|GlobalServiceMessages|HubGlobalServiceParam|data\.config\b|data\.params\b|data\.messages\b|data\.runtimeState\b|configTree\(|paramsTree\(|messagesTree\(|setConfigValue|setRuntimeState\b|replaceConfig|/sconfig\b|sconfig-cmd' packages/core/src | wc -l
```

- [ ] **Step 2: Apply renames file by file**

Apply the symbol mapping above to each file. Files (verified via earlier grep):

- `packages/core/src/index.ts` — re-exports.
- `packages/core/src/plugins/manager-control.ts`
- `packages/core/src/ui/types/command/command.ts`
- `packages/core/src/ui/types/command/service/index.ts`
- `packages/core/src/ui/types/command/service/hub-service-data.ts` — note the `HubGlobalServiceParam` symbol; rename to `HubGlobalServiceArgs` and update its body to reflect the new `GlobalServiceArgs` parent.
- `packages/core/src/ui/command-processor/builder/builder.ts`
- `packages/core/src/ui/command-processor/builder/desc-compiler.ts`
- `packages/core/src/ui/command-processor/builder/interpreter/state-span.ts`
- `packages/core/src/ui/command-processor/builder/interpreter/parser.ts`
- `packages/core/src/ui/command-processor/builder/interpreter/modes/base.ts`
- `packages/core/src/ui/command-processor/dispatcher.ts`
- `packages/core/src/ui/command-processor/handlers/build.ts`
- `packages/core/src/ui/command-processor/handlers/invokation.ts`
- `packages/core/src/ui/command-processor/handlers/alias.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/dashboard-panel.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/sinfo-cmd.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/help-cmd.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/account-ctrl-cmd.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/log-cmd.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/config-cmd.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/cmd-alias-ctlr.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/invite-cmd.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/service-ctrl-cmd.ts`
- `packages/core/src/ui/command-processor/built-in-cmd/sconfig-cmd.ts` — rename file to `sargs-cmd.ts` and the command name from `/sconfig` to `/sargs`. Update the `data.config` reads to `data.args`. Filtering by `persistent` is Task 14.
- All `__tests__/` files under `packages/core/src/ui/command-processor/`.

- [ ] **Step 3: Rename slash-command file**

```bash
git mv packages/core/src/ui/command-processor/built-in-cmd/sconfig-cmd.ts packages/core/src/ui/command-processor/built-in-cmd/sargs-cmd.ts
```

Update any imports in `built-in-cmd/index.ts` (or wherever sconfig-cmd was imported).

- [ ] **Step 4: Slice-prefix routing in dispatcher / desc-compiler**

`desc-compiler.ts` and `dispatcher.ts` currently route incoming wire keys by their leading slash-prefix segment (`config/...`, `params/...`, `messages/...`). The new routing recognizes only `args/...` and `intercom/...`. Update those switch / map structures accordingly. Search for the literals:

```bash
grep -nE "'config/?'|'params/?'|'messages/?'" packages/core/src/ui/command-processor/
```

Replace `'config'` and `'params'` with `'args'` (collapsed); `'messages'` → `'intercom'`.

- [ ] **Step 5: Run core tests**

```bash
cd packages/core && npx jest
```

Expected: PASS all 94 tests. If a test fails because it asserted the old slice name in a snapshot, regenerate the snapshot (`npx jest -u`) only after eyeballing the new snapshot to confirm it differs only in the renamed names.

- [ ] **Step 6: Build core**

```bash
cd packages/core && npx tsc --build
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/core/
git commit -m "refactor(core): apply Arg vocabulary across hub and command-processor

Renames per docs/superpowers/specs/2026-04-29-arg-vocabulary-unification-design.md.
Slash command /sconfig → /sargs (file renamed to sargs-cmd.ts).
Slice-prefix routing in dispatcher + desc-compiler now recognizes
args/ and intercom/ instead of config/, params/, messages/."
```

---

### Task 7: Rename in `packages/node`

**Files:**
- Modify: `packages/node/src/app/cmd-node-app.ts`
- Modify: `packages/node/src/runtime/validate-args.ts`
- Modify: any tests

- [ ] **Step 1: Inventory**

```bash
grep -rnE 'OptionsTree|LeafSpec|BranchSpec|@CmdArgument\b|CmdArgumentDef|buildTreeFromClass|GlobalServiceConfig|GlobalServiceParam|GlobalServiceMessages|configTree|paramsTree|messagesTree|\.config:|\.params:|\.messages:' packages/node/src
```

- [ ] **Step 2: Apply renames**

Open `packages/node/src/app/cmd-node-app.ts`. Update lines around 105 (`messages: buildTreeFromClass(meta.messages)`) and 345/353 to:

```typescript
// node-side manifest wiring
args: buildArgTreeFromClass(meta.args),
intercom: buildArgTreeFromClass(meta.intercom),
```

Same for the lines around 345/353 (the inbound-invoke handler that unflattens):

```typescript
// before:
//   const messagesTree = buildTreeFromClass(meta.messages)
//   const messages = unflattenValue(messagesTree, sliced.messages)
// after:
const intercomTree = buildArgTreeFromClass(meta.intercom)
const intercom = unflattenArgs(intercomTree, sliced.intercom)
```

The `sliced` map's keys also change (`config/...`, `params/...`, `messages/...` → `args/...`, `intercom/...`); look for the slicing logic earlier in the same function and update it. Likely a `splitByPrefix` or `partitionBySlice` helper — same shape, two prefixes instead of three.

- [ ] **Step 3: `runtime/validate-args.ts`**

The file's purpose is unchanged (run validators on each leaf after unflatten). Apply the symbol renames; no logic changes.

- [ ] **Step 4: Update tests**

The four `cmd-node-app*.test.ts` files reference `@CmdArgument`. Swap to `@CmdArg` and update any service-decorator payload literals (`config: ...` → `args: ...`).

- [ ] **Step 5: Run node tests**

```bash
cd packages/node && npx jest
```

Expected: PASS all 54 tests.

- [ ] **Step 6: Build node**

```bash
cd packages/node && npx tsc --build
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add packages/node/
git commit -m "refactor(node): apply Arg vocabulary in node app + invoke server"
```

---

### Task 8: Rename in `plugins/storage/mongo`

**Files:**
- Modify: `plugins/storage/mongo/src/repos/account-handle.ts`
- Modify: any other repo files using `data.config`
- Modify: tests

- [ ] **Step 1: Inventory**

```bash
grep -rnE 'data\.config\b|replaceConfig\b' plugins/storage/mongo/src
```

- [ ] **Step 2: Apply renames**

Open `plugins/storage/mongo/src/repos/account-handle.ts`:

- Line 156: method signature `replaceConfig(config: Record<string, unknown>)` → `replaceArgs(args: Record<string, unknown>)`.
- Line 157: `this.doc.set('data.config', config)` → `this.doc.set('data.args', args)`.

Update any other call-sites flagged by Step 1.

- [ ] **Step 3: Update tests**

```bash
grep -rnE 'data\.config\b|replaceConfig\b' plugins/storage/mongo/src/__tests__
```

Apply renames.

- [ ] **Step 4: Run tests**

```bash
cd plugins/storage/mongo && npx jest
```

Expected: PASS all 19 tests.

- [ ] **Step 5: Build**

```bash
cd plugins/storage/mongo && npx tsc --build
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add plugins/storage/mongo/
git commit -m "refactor(storage-mongo): rename data.config field + replaceConfig method to args

Mongoose-doc field 'data.config' → 'data.args'; IServiceAccountLayer
contract method replaceConfig → replaceArgs. The migration that
copies existing data.config docs into data.args lives in Task 13."
```

---

### Task 9: Rename in `plugins/ui/{web,cli,telegram}`

**Files:**
- Modify: `plugins/ui/web/src/web-ui.ts:533` and surrounding
- Modify: `plugins/ui/cli/src/**/*.ts` (search)
- Modify: `plugins/ui/telegram/src/telegram-ui.ts` and any others

- [ ] **Step 1: Inventory**

```bash
grep -rnE 'data\.config\b|data\.params\b|data\.messages\b|data\.runtimeState\b|@CmdArgument\b|/sconfig\b|configTree|paramsTree|messagesTree' plugins/ui
```

- [ ] **Step 2: Apply renames**

Each match: swap to the new symbol. The web UI's `web-ui.ts:533` reads `module.record.data.config` — that becomes `module.record.data.args`.

User-facing labels (e.g. CLI help text) that say "config" / "params" / "messages" should say "args" / "intercom" — but keep visible help-text changes minimal (don't rewrite copy beyond the rename).

- [ ] **Step 3: Run tests for each UI plugin**

```bash
cd plugins/ui/web && npx jest && cd ../../..
cd plugins/ui/cli && npx jest && cd ../../..
cd plugins/ui/telegram && npx jest && cd ../../..
```

Expected: all green.

- [ ] **Step 4: Build each**

```bash
cd plugins/ui/web && npx tsc --build && cd ../../..
cd plugins/ui/cli && npx tsc --build && cd ../../..
cd plugins/ui/telegram && npx tsc --build && cd ../../..
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add plugins/ui/
git commit -m "refactor(ui-plugins): apply Arg vocabulary in web/cli/telegram UIs"
```

---

### Task 10: Rename in `examples/scraper-node` (the heavy lift)

**Files:**
- Rename: `examples/scraper-node/src/scraper-service/config-tree.ts` → `args-tree.ts`
- Modify: `examples/scraper-node/src/scraper-service/service.ts`
- Modify: `examples/scraper-node/src/scraper-service/system-config.ts` (comment only)
- Modify: tests

This is the largest example. Once this builds, the whole monorepo builds.

- [ ] **Step 1: Rename the args tree file**

```bash
git mv examples/scraper-node/src/scraper-service/config-tree.ts examples/scraper-node/src/scraper-service/args-tree.ts
```

- [ ] **Step 2: Rewrite the args tree**

Open `examples/scraper-node/src/scraper-service/args-tree.ts`. The `ScraperConfigData` and `ScraperParamsData` classes merge into a single `ScraperArgs` class; every leaf that *was* in `ScraperConfigData` gets `persistent: true`. `ScraperMessagesData` becomes `ScraperIntercom` (no persistence; it's intercom). All `@CmdArgument` references become `@CmdArg`. `options:` becomes `choices:`.

```typescript
// examples/scraper-node/src/scraper-service/args-tree.ts
import {
    GlobalServiceArgs,
    GlobalServiceIntercom,
    CmdServiceData,
    CmdArg,
} from '@cmd-hub/core'
import { OrgData } from '../types'

const SOURCE_OPTIONS = [
    'all',
    'yandex-business',
    'ai-agent',
    'yandex-html',
    'zoon',
    'flamp',
] as const
const EXPORTER_OPTIONS = ['json', 'csv', 'google-sheets'] as const

const positiveInt = (raw: string): true | string => {
    if (!/^\d+$/.test(raw)) return 'must be a positive integer'
    if (Number.parseInt(raw, 10) <= 0) return 'must be > 0'
    return true
}

const zeroToOne = (raw: string): true | string => {
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) return 'must be a number'
    if (n < 0 || n > 1) return 'must be between 0 and 1'
    return true
}

const nonEmptyString = (raw: string): true | string =>
    raw.trim().length > 0 ? true : 'must not be empty'

class AIAgentSettings {
    @CmdArg({
        required: false,
        persistent: true,
        description: 'Backing model id',
        choices: ['qwen2.5:7b', 'qwen3:8b', 'qwen3.5:9b', 'gpt-4o', 'gpt-4o-mini'],
        default: 'qwen2.5:7b',
    })
    model?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Sampling temperature (0..1)',
        type: 'number',
        choices: ['0.0', '0.2', '0.5', '0.7', '1.0'],
        default: '0.2',
        validator: zeroToOne,
    })
    temperature?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Max tool calls per task',
        type: 'number',
        choices: ['10', '25', '50', '100'],
        default: '25',
        validator: positiveInt,
    })
    maxToolCalls?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Per-tool timeout (ms)',
        type: 'number',
        choices: ['30000', '60000', '120000'],
        default: '60000',
        validator: positiveInt,
    })
    toolTimeoutMs?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Whole-task timeout (ms)',
        type: 'number',
        choices: ['60000', '300000', '600000', '1800000', '3600000'],
        default: '3600000',
        validator: positiveInt,
    })
    totalTimeoutMs?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Override LLM base URL',
        default: 'http://127.0.0.1:11434/v1',
    })
    baseUrl?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'API key (free-form; empty = none)',
        default: '',
    })
    apiKey?: string
}

class GoogleSheetsSettings {
    @CmdArg({
        required: false,
        persistent: true,
        description: 'Service-account credentials JSON',
        default: '',
    })
    credentials?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Target spreadsheet id',
        default: '',
    })
    spreadsheetId?: string
}

export class ScraperArgs extends GlobalServiceArgs {
    @CmdArg({
        required: true,
        persistent: true,
        position: 1,
        description: "Search query (e.g. 'стоматологии Москва')",
        validator: nonEmptyString,
    })
    query?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'City/region filter',
    })
    city?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Max organizations to collect',
        type: 'number',
        choices: ['100', '1000', '10000', '100000', '1000000'],
        default: '10000',
        validator: positiveInt,
    })
    limit?: number

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Export format',
        choices: [...EXPORTER_OPTIONS],
        default: 'json',
    })
    format?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: "Sources to scrape (comma-separated, or 'all')",
        choices: [...SOURCE_OPTIONS],
        default: 'all',
    })
    sources?: string

    @CmdArg({
        required: false,
        persistent: true,
        description: 'AI agent settings',
        childClass: AIAgentSettings,
    })
    aiAgent?: AIAgentSettings

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Google Sheets export config',
        childClass: GoogleSheetsSettings,
    })
    googleSheets?: GoogleSheetsSettings

    @CmdArg({
        required: false,
        persistent: true,
        description: 'Per-request delay in milliseconds',
        type: 'number',
        choices: ['250', '500', '1000', '2000', '5000'],
        default: '1000',
        validator: positiveInt,
    })
    requestDelayMs?: number
}

export class ScraperIntercom extends GlobalServiceIntercom {
    @CmdArg({ required: false, standalone: true, description: 'Pause scraping' })
    pause?: boolean

    @CmdArg({ required: false, standalone: true, description: 'Resume scraping' })
    resume?: boolean

    @CmdArg({ required: false, standalone: true, description: 'Stop and export current results' })
    stop?: boolean

    @CmdArg({ required: false, standalone: true, description: 'Export current results now' })
    export?: boolean
}

export interface ScraperState {
    results: OrgData[]
    processedUrls: string[]
    lastQuery?: string
}

export type ScraperServiceDataType = CmdServiceData<
    ScraperArgs,
    ScraperIntercom,
    ScraperState
>

export const scraperDefaultData: ScraperServiceDataType = new CmdServiceData(
    new ScraperArgs(),
    new ScraperIntercom(),
)

export type AIAgentConfig = AIAgentSettings
export type GoogleSheetsConfig = GoogleSheetsSettings
export type ScraperConfig = ScraperArgs
```

- [ ] **Step 3: Update `service.ts`**

Open `examples/scraper-node/src/scraper-service/service.ts`. Apply:

- Imports: `ScraperConfigData`, `ScraperParamsData`, `ScraperMessagesData` → `ScraperArgs`, `ScraperIntercom`. Path: `./config-tree` → `./args-tree`.
- `@CmdService` payload: `{ config: ScraperConfigData, params: ScraperParamsData, messages: ScraperMessagesData }` → `{ args: ScraperArgs, intercom: ScraperIntercom }`.
- Body: `this.data.config.query` → `this.data.args.query`; `this.data.config.format` → `this.data.args.format`; same for any other slice access in this file.

- [ ] **Step 4: Update `system-config.ts` comment**

Open `examples/scraper-node/src/scraper-service/system-config.ts`. Line 8: `merged into \`this.data.config\`` → `merged into \`this.data.args\``.

- [ ] **Step 5: Update tests**

```bash
grep -rnE 'data\.config\b|data\.params\b|data\.messages\b|@CmdArgument\b|ScraperConfigData|ScraperParamsData|ScraperMessagesData|configTree|paramsTree|messagesTree' examples/scraper-node/src
```

For each match in `__tests__/`, apply the symbol renames. The `manifest-smoke.test.ts:90` line currently navigates `.options!.branch!.children.messages.branch!.children`; update to `.args!.branch!.children.intercom.branch!.children` (note the proto field rename `options` → `args` in `Command`, *and* the `LeafNode.options` → `ArgLeafNode.choices`; the structural path here is talking about the proto Command's tree field).

- [ ] **Step 6: Run scraper-node tests**

```bash
cd examples/scraper-node && npx jest
```

Expected: PASS all 34 tests.

- [ ] **Step 7: Build the whole monorepo**

```bash
cd /home/data/projects/bots/scrap-hub && npm run build
```

Expected: every workspace builds. If anything fails, the failure is a missed call-site — fix inline.

- [ ] **Step 8: Run all tests**

```bash
cd /home/data/projects/bots/scrap-hub && npm test
```

Expected: 322 unit tests pass.

- [ ] **Step 9: Commit**

```bash
git add examples/scraper-node/
git commit -m "refactor(scraper): apply Arg vocabulary; merge ScraperConfig+Params into ScraperArgs

config-tree.ts → args-tree.ts. ScraperConfigData + ScraperParamsData
collapse into one ScraperArgs class with persistent:true on every
leaf that used to be in ScraperConfigData. ScraperMessagesData →
ScraperIntercom. The four GlobalServiceArgs ephemeral flags
(sessionId/noDashboard/noCache/now) inherit from GlobalServiceArgs.

Phase 2 of arg-vocabulary-unification complete; full monorepo
builds and all 322 unit tests pass with renames only."
```

Phase 2 is complete: every workspace builds and all unit tests pass with the new vocabulary, but the persistence semantics still match the old behavior (everything in `data.args` is treated as persistent). Phase 3 wires the per-leaf flag.

---

## Phase 3 — Structural changes (TDD)

### Task 11: Wire the `persistent` flag in `BaseCommandService.initSession()`

**Files:**
- Modify: `packages/common/src/service/base-command-service.ts`
- Modify: `packages/common/src/service/__tests__/base-command-service.test.ts`

This task is the bootstrapping order change described in the spec. From now on, only persistent leaves go through the layered store; ephemeral leaves bypass it.

- [ ] **Step 1: Write failing tests for the new merge semantics**

Open `packages/common/src/service/__tests__/base-command-service.test.ts` and add two new tests at the end of the existing test suite:

```typescript
describe('initSession persistent-flag filtering', () => {
    it('only writes persistent leaves to the session layer', async () => {
        class MyArgs extends GlobalServiceArgs {
            @CmdArg({ persistent: true, description: 'persistent value' })
            kept?: string

            @CmdArg({ description: 'ephemeral value' }) // persistent: false (default)
            ephemeral?: string
        }
        class MyIntercom extends GlobalServiceIntercom {}

        type MyData = CmdServiceData<MyArgs, MyIntercom, {}>
        class TestSvc extends BaseCommandService<MyData> {
            protected async runWrapper() { /* no-op */ }
            protected async terminateWrapper() { /* no-op */ }
            async receiveMsg() { /* no-op */ }
            clone() { return this }
        }

        const { store, sessionLayer } = makeMemoryStore() // helper from existing tests
        BaseCommandService.setStore(store)
        const defaultData = new CmdServiceData<MyArgs, MyIntercom, {}>(
            new MyArgs(),
            new MyIntercom(),
        )
        const svc = new TestSvc('user-1', defaultData, {
            args: { kept: 'k1', ephemeral: 'e1' } as Partial<MyArgs>,
        } as Partial<MyData>, 'svc')

        await svc.Initialize()

        const layerArgs = sessionLayer.data.args as Record<string, unknown> | undefined
        expect(layerArgs).toBeDefined()
        expect(layerArgs!.kept).toBe('k1')
        expect(layerArgs!.ephemeral).toBeUndefined()
    })

    it('reads ephemeral leaves from input, not the layered store', async () => {
        class MyArgs extends GlobalServiceArgs {
            @CmdArg({ persistent: true })
            kept?: string

            @CmdArg() // ephemeral
            ephemeral?: string
        }
        class MyIntercom extends GlobalServiceIntercom {}

        type MyData = CmdServiceData<MyArgs, MyIntercom, {}>
        class TestSvc extends BaseCommandService<MyData> {
            protected async runWrapper() {}
            protected async terminateWrapper() {}
            async receiveMsg() {}
            clone() { return this }
        }

        const { store, sessionLayer, accountLayer } = makeMemoryStore()
        // Pre-seed the store with both keys; ephemeral should NOT be picked up.
        ;(sessionLayer.data as any).args = { kept: 'session-k', ephemeral: 'session-e' }
        BaseCommandService.setStore(store)

        const defaultData = new CmdServiceData<MyArgs, MyIntercom, {}>(
            new MyArgs(),
            new MyIntercom(),
        )
        const svc = new TestSvc('user-1', defaultData, {
            args: { ephemeral: 'input-e' } as Partial<MyArgs>,
        } as Partial<MyData>, 'svc')

        await svc.Initialize()

        // Persistent: layered merge picks up the session value.
        expect((svc as any).data.args.kept).toBe('session-k')
        // Ephemeral: from input only; the session-layer value is ignored.
        expect((svc as any).data.args.ephemeral).toBe('input-e')
    })
})
```

`makeMemoryStore` is the test helper already used in this file; reuse it. If it doesn't exist, lift it from the existing tests' `beforeEach` setup.

- [ ] **Step 2: Run the new tests; expect them to FAIL**

```bash
cd packages/common && npx jest src/service/__tests__/base-command-service.test.ts -t "persistent-flag filtering"
```

Expected: FAIL — current `initSession()` writes the entire `args` map to the layer (including ephemeral) and reads the entire layer back (including ephemeral leaves the user didn't pass).

- [ ] **Step 3: Implement the filtered merge in `initSession()`**

Open `packages/common/src/service/base-command-service.ts`. Replace the body of `initSession()` with this version:

```typescript
async initSession() {
    const inputData = this.inputServiceData
    const defaultData = this.defaultData
    const inputArgs = (inputData.args ?? {}) as Record<string, unknown>

    const _session_id: string =
        (inputArgs as any)?.s ||
        (inputArgs as any)?.sessionId ||
        DEFAULT_ACCOUNT_SESSION_NAME
    this.data.sessionId = _session_id

    const { sessionLayerData, accountLayerData, sessionLayer } = await this.retrieveAccountData(true)

    const noCache = isFlagSet(inputArgs['noCache'])

    // Walk the args tree to learn which leaves are persistent.
    const tree = this.argsTree()
    const persistentPaths = new Set<string>()
    const ephemeralPaths = new Set<string>()
    for (const { pathKey, leaf } of walkArgLeaves(tree)) {
        if (leaf.persistent) persistentPaths.add(pathKey)
        else ephemeralPaths.add(pathKey)
    }

    // Project a record into a persistent-only / ephemeral-only subset by walking
    // its (already nested) shape and re-flattening through the tree.
    const flatInput = flattenArgs(tree, inputArgs)
    const flatAccount = noCache
        ? new Map<string, string>()
        : flattenArgs(tree, (accountLayerData[SESSION_ARGS_KEY] ?? {}))
    const flatSession = noCache
        ? new Map<string, string>()
        : flattenArgs(tree, (sessionLayerData[SESSION_ARGS_KEY] ?? {}))
    const flatDefaults = flattenArgs(tree, defaultData.args)

    const filterMap = (m: Map<string, string>, allowed: Set<string>): Map<string, string> => {
        const out = new Map<string, string>()
        for (const [k, v] of m) if (allowed.has(k)) out.set(k, v)
        return out
    }

    // Persistent: defaults ← account ← session ← input
    const mergedPersistent = new Map<string, string>()
    for (const m of [
        filterMap(flatDefaults, persistentPaths),
        filterMap(flatAccount, persistentPaths),
        filterMap(flatSession, persistentPaths),
        filterMap(flatInput, persistentPaths),
    ]) {
        for (const [k, v] of m) mergedPersistent.set(k, v)
    }

    // Ephemeral: defaults ← input only
    const mergedEphemeral = new Map<string, string>()
    for (const m of [
        filterMap(flatDefaults, ephemeralPaths),
        filterMap(flatInput, ephemeralPaths),
    ]) {
        for (const [k, v] of m) mergedEphemeral.set(k, v)
    }

    const allMerged = new Map<string, string>([...mergedPersistent, ...mergedEphemeral])
    const aArgs = unflattenArgs(tree, allMerged) as Record<string, unknown>

    // State (unchanged from the rename-only version):
    const existingState = (sessionLayerData[SESSION_STATE_KEY] ?? {}) as Record<string, unknown>
    let aState: Record<string, unknown> = existingState
    const initState = !aState || Object.keys(aState).length === 0
    if (initState) {
        aState = {
            ...defaultData.state,
            ...((inputData as any).state ?? {}),
        } as Record<string, unknown>
    }

    if (!noCache) {
        // Only persist the persistent slice.
        const persistentNested = unflattenArgs(tree, mergedPersistent) as Record<string, unknown>
        await sessionLayer.setField(SESSION_ARGS_KEY, persistentNested)
        if (initState) {
            await sessionLayer.setField(SESSION_STATE_KEY, aState)
        }
    }

    this.data = {
        args: aArgs,
        state: aState,
        sessionId: sessionLayer.name,
        intercom: defaultData.intercom,
    } as ServiceDataType
}
```

Add the missing imports at the top of the file:

```typescript
import { walkArgLeaves, flattenArgs, unflattenArgs } from '../command/tree'
```

- [ ] **Step 4: Re-run the new tests; expect PASS**

```bash
cd packages/common && npx jest src/service/__tests__/base-command-service.test.ts -t "persistent-flag filtering"
```

Expected: PASS.

- [ ] **Step 5: Run the full common suite**

```bash
cd packages/common && npx jest
```

Expected: PASS all tests. Existing tests that asserted on `sessionLayer.data.args` may need updating — under the new semantics, the layer now contains only persistent leaves. Where a test set `sessionConfig` with arbitrary keys and expected those keys to come back, mark those keys as persistent in the test's args class.

- [ ] **Step 6: Commit**

```bash
git add packages/common/src/service/
git commit -m "feat(common): wire ArgLeaf.persistent into initSession bootstrapping

initSession now partitions the merged args tree into persistent vs.
ephemeral leaves. Persistent leaves take part in the layered merge
(defaults ← account ← session ← input) and write back to the session
layer. Ephemeral leaves are read from input only and never persisted.
The four GlobalServiceArgs flags (sessionId/noDashboard/noCache/now)
are now filtered out of the persistent merge by virtue of not having
persistent:true."
```

---

### Task 12: Add `/sargs` filter — render only persistent leaves

**Files:**
- Modify: `packages/core/src/ui/command-processor/built-in-cmd/sargs-cmd.ts`
- Modify: tests

- [ ] **Step 1: Find the render path**

```bash
grep -nE 'walkArgLeaves|argsTree|nodeAtPath|argNodeAtPath' packages/core/src/ui/command-processor/built-in-cmd/sargs-cmd.ts
```

The command renders the service's args tree. Identify the loop that produces the editable list (it walks leaves and produces UI rows).

- [ ] **Step 2: Write a failing test**

Open `packages/core/src/ui/command-processor/built-in-cmd/__tests__/sargs-cmd.test.ts` (create it if absent).

```typescript
import { argLeaf, argBranch } from '@cmd-hub/common'
import { renderEditableLeaves } from '../sargs-cmd' // assumed exported helper

describe('sargs render filter', () => {
    it('omits ephemeral leaves from the editable list', () => {
        const tree = argBranch({
            kept: argLeaf({ persistent: true, description: 'persistent' }),
            tmp: argLeaf({ description: 'ephemeral' }), // persistent defaults to false
        })
        const rows = renderEditableLeaves(tree)
        expect(rows.map(r => r.path)).toEqual(['kept'])
    })
})
```

If `sargs-cmd.ts` doesn't expose `renderEditableLeaves`, extract the leaf-walking logic into a small named function and export it from `sargs-cmd.ts` so the test can call it directly.

- [ ] **Step 3: Run the test; expect FAIL**

```bash
cd packages/core && npx jest src/ui/command-processor/built-in-cmd/__tests__/sargs-cmd.test.ts
```

Expected: FAIL (`tmp` is in the rows because the filter doesn't exist).

- [ ] **Step 4: Implement the filter**

In `packages/core/src/ui/command-processor/built-in-cmd/sargs-cmd.ts`, find the leaf-walk and add a filter:

```typescript
import { walkArgLeaves, type ArgTree } from '@cmd-hub/common'

export function renderEditableLeaves(tree: ArgTree): Array<{ path: string; leaf: any }> {
    const out: Array<{ path: string; leaf: any }> = []
    for (const { pathKey, leaf } of walkArgLeaves(tree)) {
        if (!leaf.persistent) continue
        out.push({ path: pathKey, leaf })
    }
    return out
}
```

(The actual return shape should match the existing `sargs-cmd.ts` row type. The key change is the `if (!leaf.persistent) continue;`.)

- [ ] **Step 5: Re-run; expect PASS**

```bash
cd packages/core && npx jest src/ui/command-processor/built-in-cmd/__tests__/sargs-cmd.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run the full core suite**

```bash
cd packages/core && npx jest
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/ui/command-processor/built-in-cmd/
git commit -m "feat(core): /sargs filters render to persistent leaves only

Ephemeral leaves (persistent: false) no longer appear in the /sargs
editor. Standalone runtime flags (sessionId/noDashboard/noCache/now)
are silently omitted, restoring the user-facing ergonomics that the
old slice-based split provided."
```

---

### Task 13: Mongo migration hook for existing `data.config` documents

**Files:**
- Modify: `plugins/storage/mongo/src/middleware/mongo-storage-middleware.ts`
- Create: `plugins/storage/mongo/src/migrations/0001-config-to-args.ts`
- Create: `plugins/storage/mongo/src/__tests__/migrate-config-to-args.test.ts`

The migration runs once per node on first boot of the new code. It copies any `data.config` map into `data.args` and unsets `data.config`. Idempotent — safe to re-run.

- [ ] **Step 1: Write the failing migration test**

```typescript
// plugins/storage/mongo/src/__tests__/migrate-config-to-args.test.ts
import { migrateConfigToArgs } from '../migrations/0001-config-to-args'
import { AccountModuleModel } from '../models/account/account-module.model'
import { AccountSessionModel } from '../models/account/account-session.model'
import { setupTestDb, teardownTestDb } from './_helpers' // assumed existing

describe('migrateConfigToArgs', () => {
    beforeEach(setupTestDb)
    afterEach(teardownTestDb)

    it('copies AccountModule data.config to data.args and unsets data.config', async () => {
        const m = await AccountModuleModel.create({
            name: 'svc',
            account_id: '000000000000000000000001',
            data: { config: { query: 'q1', limit: '10' } },
        })

        await migrateConfigToArgs()

        const reloaded = await AccountModuleModel.findById(m._id).lean()
        expect((reloaded!.data as any).args).toEqual({ query: 'q1', limit: '10' })
        expect((reloaded!.data as any).config).toBeUndefined()
    })

    it('is idempotent — second run is a no-op', async () => {
        await AccountModuleModel.create({
            name: 'svc',
            account_id: '000000000000000000000001',
            data: { args: { x: '1' } },
        })

        await migrateConfigToArgs()
        await migrateConfigToArgs()

        const docs = await AccountModuleModel.find({}).lean()
        expect((docs[0].data as any).args).toEqual({ x: '1' })
        expect((docs[0].data as any).config).toBeUndefined()
    })

    it('migrates AccountSession data.config too', async () => {
        const s = await AccountSessionModel.create({
            name: 'sess',
            expirity: 86_400_000,
            incrementalExpirity: false,
            data: { config: { y: '2' }, runtimeState: { results: [] } },
        })

        await migrateConfigToArgs()

        const reloaded = await AccountSessionModel.findById(s._id).lean()
        expect((reloaded!.data as any).args).toEqual({ y: '2' })
        expect((reloaded!.data as any).state).toEqual({ results: [] })
        expect((reloaded!.data as any).config).toBeUndefined()
        expect((reloaded!.data as any).runtimeState).toBeUndefined()
    })
})
```

(Also covers `runtimeState` → `state` rename for session docs, since they live in the same `data` subtree.)

- [ ] **Step 2: Run; expect FAIL (file doesn't exist)**

```bash
cd plugins/storage/mongo && npx jest src/__tests__/migrate-config-to-args.test.ts
```

Expected: FAIL with "Cannot find module '../migrations/0001-config-to-args'".

- [ ] **Step 3: Implement the migration**

```typescript
// plugins/storage/mongo/src/migrations/0001-config-to-args.ts
import { AccountModuleModel } from '../models/account/account-module.model'
import { AccountSessionModel } from '../models/account/account-session.model'

/**
 * One-time migration: rename data.config → data.args and data.runtimeState
 * → data.state on every AccountModule and AccountSession doc that still
 * carries the old keys. Idempotent.
 */
export async function migrateConfigToArgs(): Promise<{ moduleCount: number; sessionCount: number }> {
    const moduleResult = await AccountModuleModel.updateMany(
        { 'data.config': { $exists: true } },
        [
            { $set: { 'data.args': '$data.config' } },
            { $unset: ['data.config'] },
        ],
    )

    // Sessions also carry runtimeState in the same subtree.
    const sessionResult = await AccountSessionModel.updateMany(
        {
            $or: [
                { 'data.config': { $exists: true } },
                { 'data.runtimeState': { $exists: true } },
            ],
        },
        [
            {
                $set: {
                    'data.args': { $ifNull: ['$data.config', '$data.args'] },
                    'data.state': { $ifNull: ['$data.runtimeState', '$data.state'] },
                },
            },
            { $unset: ['data.config', 'data.runtimeState'] },
        ],
    )

    return {
        moduleCount: moduleResult.modifiedCount ?? 0,
        sessionCount: sessionResult.modifiedCount ?? 0,
    }
}
```

- [ ] **Step 4: Run; expect PASS**

```bash
cd plugins/storage/mongo && npx jest src/__tests__/migrate-config-to-args.test.ts
```

Expected: PASS.

- [ ] **Step 5: Wire the migration into the storage middleware**

Open `plugins/storage/mongo/src/middleware/mongo-storage-middleware.ts`. Find the middleware's `Initialize` (or equivalent) phase and add a call to `migrateConfigToArgs()` after the connection is established but before any service consumes the store.

```typescript
// inside MongoStorageMiddleware.Initialize() (or equivalent boot hook)
const result = await migrateConfigToArgs()
if (result.moduleCount > 0 || result.sessionCount > 0) {
    log.info(`mongo-storage: migrated ${result.moduleCount} modules + ${result.sessionCount} sessions to args/state schema`)
}
```

Add the import at the top of `mongo-storage-middleware.ts`:

```typescript
import { migrateConfigToArgs } from '../migrations/0001-config-to-args'
```

- [ ] **Step 6: Run the storage-mongo suite**

```bash
cd plugins/storage/mongo && npx jest
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/storage/mongo/
git commit -m "feat(storage-mongo): one-time migration data.config→data.args, runtimeState→state

Idempotent migration runs once on first boot of the new code. Renames
both AccountModule and AccountSession docs in a single aggregation
update per collection. Logs a count summary when any docs were
migrated."
```

---

### Task 14: End-to-end golden-test gate

**Files:**
- Run: `npm run test:e2e`

This is the regression boundary per `project_distributed_migration.md`. No code changes here — just run the gate.

- [ ] **Step 1: Build everything fresh**

```bash
cd /home/data/projects/bots/scrap-hub && npm run build
```

Expected: every workspace builds cleanly.

- [ ] **Step 2: Run unit tests**

```bash
cd /home/data/projects/bots/scrap-hub && npm test
```

Expected: 322+ tests pass (slightly more, given the new tests added in Tasks 11–13).

- [ ] **Step 3: Run the e2e suite**

```bash
cd /home/data/projects/bots/scrap-hub && npm run test:e2e
```

Expected: PASS. The golden scraper end-to-end test verifies that a full hub-node run produces the expected output. If it fails, the most likely cause is a wire-prefix mismatch (a `config/` somewhere that should be `args/`) or a slice-name mismatch in the dispatcher.

- [ ] **Step 4: Manually exercise `/sargs`**

Spin up a hub + node:

```bash
cd /home/data/projects/bots/scrap-hub && npm run start:docker
```

Connect a UI (e.g. via the configured Telegram bot or web UI). Invoke `/sargs` for the scraper service. Verify:
- The four ephemeral flags (`sessionId`, `noDashboard`, `noCache`, `now`) do **not** appear in the editor.
- All `ScraperArgs` fields (query, city, limit, format, sources, aiAgent.*, googleSheets.*, requestDelayMs) appear and are editable.
- Saving a value and re-running the service picks up the saved value.

Tear down:

```bash
cd /home/data/projects/bots/scrap-hub && npm run stop:docker
```

- [ ] **Step 5: Update CLAUDE.md**

Open `CLAUDE.md`. The "Command argument model" section uses old names (`@CmdArgument`, `OptionsTree`, `LeafSpec.options`, slice-prefix examples like `config/aiAgent/model`). Rewrite that section to the new vocabulary:

- `@CmdArgument` → `@CmdArg`
- `OptionsTree` → `ArgTree`, `LeafSpec`/`BranchSpec` → `ArgLeaf`/`ArgBranch`
- `static options: string[]` → `static choices: string[]` (and the explanatory sentence)
- Wire-key examples: `config/aiAgent/model` → `args/aiAgent/model`; `params/sessionId` → `args/sessionId`; `messages/...` → `intercom/...`
- Add a paragraph: "Per-leaf `persistent: true` opts a leaf into the layered account/session store; without it (default), the leaf is per-invocation only."

Keep the section's structure; only update the content.

- [ ] **Step 6: Update `docs/cli.md` if it mentions the old slice names or `/sconfig`**

```bash
grep -nE 'config/?|params/?|messages/?|/sconfig\b|@CmdArgument\b|OptionsTree' docs/cli.md docs/node-deployment.md docs/roadmap.md
```

Apply renames.

- [ ] **Step 7: Commit docs updates**

```bash
git add CLAUDE.md docs/
git commit -m "docs: update CLAUDE.md + docs/ to Arg vocabulary

Rewrites the 'Command argument model' section in CLAUDE.md and
updates docs/cli.md and friends to reference @CmdArg, ArgTree,
choices (was options), and the args/intercom/state slice names.
Documents the new persistent flag."
```

---

### Task 15: Self-verification gate

- [ ] **Step 1: Verify no old symbols remain anywhere**

```bash
cd /home/data/projects/bots/scrap-hub && grep -rnE '\b(OptionsTree|LeafSpec|BranchSpec|LeafType|LeafValidator|LeafOptions|BranchOptions|walkLeaves|flattenValue|unflattenValue|nodeAtPath|@CmdArgument|CmdArgumentDef|buildTreeFromClass|GlobalServiceConfig|GlobalServiceParam|GlobalServiceMessages|HubGlobalServiceParam|configTree|paramsTree|messagesTree|setConfigValue|setRuntimeStateValue|setRuntimeState|replaceConfig|/sconfig)\b' --include='*.ts' --include='*.proto' --include='*.md'
```

Expected: empty output (or output limited to `docs/superpowers/specs/2026-04-29-arg-vocabulary-unification-design.md` and `docs/superpowers/plans/2026-04-29-arg-vocabulary-unification.md` themselves, which discuss the rename).

If any other matches surface, fix them inline and amend the previous task's commit (or add a small follow-up commit).

- [ ] **Step 2: Verify wire-prefix consistency**

```bash
grep -rnE "'config/|'params/|'messages/" --include='*.ts' /home/data/projects/bots/scrap-hub/packages /home/data/projects/bots/scrap-hub/plugins /home/data/projects/bots/scrap-hub/examples
```

Expected: empty.

- [ ] **Step 3: Build + test once more**

```bash
cd /home/data/projects/bots/scrap-hub && npm run build && npm test
```

Expected: green.

- [ ] **Step 4: Final commit (only if Step 1/2 surfaced anything)**

```bash
git add -p   # review hunks
git commit -m "chore: clean up trailing references to legacy Arg vocabulary"
```

---

## Self-review

**Spec coverage:**
- Vocabulary table: Phase 1 + Phase 2 (Tasks 1–10).
- `persistent` flag: Phase 1 introduced the type field; Task 11 wires it into `initSession()`.
- `/sargs` filter: Task 12.
- Wire (proto) changes: Task 5.
- Mongo migration: Task 13.
- Hub-side dispatcher + builder slice-prefix routing: Task 6.
- `/sinfo` slice labels: covered as part of Task 6.
- One-shot commands: Tasks 1–2 (decorator rename); `ctx.args` keeps its name as designed.
- File-by-file impact list: covered across Phases 1–2.
- Migration plan: Tasks 13 (Mongo) + 14 (e2e gate).
- Test gate: Task 14.

All spec sections have at least one task.

**Placeholder scan:** No "TBD" / "implement later" / "appropriate handling" — every step has either exact code, exact commands, or an exact rename target with a `grep` to enumerate the call-sites.

**Type consistency:** The new types used across tasks line up:
- `ArgTree`, `ArgLeaf`, `ArgBranch`, `ArgLeafDef`, `ArgBranchDef`, `ArgValueType`, `ArgValidator` — defined in Task 1, used in Tasks 2/4/6/11/12.
- `CmdArg`, `ArgDef`, `CMD_ARG_META_KEY`, `buildArgTreeFromClass` — defined in Task 2, used in Tasks 3/4/6/7/9/10/11/12.
- `walkArgLeaves`, `flattenArgs`, `unflattenArgs`, `argNodeAtPath` — defined in Task 1, used in Task 11.
- `argLeaf()`, `argBranch()` builders — defined in Task 1, used in Task 12 test.
- `argsTree()`, `intercomTree()`, `setArgValue`, `setStateValue`, `setState` — defined in Task 4, used in Task 11.
- `replaceArgs` (was `replaceConfig`) — renamed in Task 4 (`@cmd-hub/common` interface) and Task 8 (Mongo implementation).
- `SESSION_ARGS_KEY`, `SESSION_STATE_KEY` — defined in Task 4, used in Task 11 / Task 13.
- `migrateConfigToArgs` — defined in Task 13, called in Task 13 Step 5.
- `data.args` / `data.intercom` / `data.state` — slice fields defined in Task 3, used everywhere downstream.

No mismatched names found.

**Risks flagged for execution:**
1. `arg-decorator.ts` Step 2 imports `argLeaf` and `argBranch` but the existing decorator code calls them `leaf()` and `branch()` (the old builder names). Make sure the imports match the new names from Task 1 — already covered in the code block.
2. The proto `LeafNode.options` field rename to `choices` is a breaking wire change; matched hub + node binaries must ship together. Same PR keeps that invariant.
3. Phase 2 tests will start passing only at the end of the phase (after Task 10) because each package depends on its predecessor in the dependency graph (`common` → `transport` → `core`/`node` → `plugins/*` → `examples/*`). Run `npm run build` from the root after each task to catch ordering issues early.
