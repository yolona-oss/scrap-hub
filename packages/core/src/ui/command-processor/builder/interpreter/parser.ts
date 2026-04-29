import {
    Chain,
    chainHandlerFactory,
    createChainFallbackHandler,
    argNodeAtPath,
    walkArgLeaves,
    ARG_PATH_DELIMITER,
    type IChainHandler,
    type ArgLeaf,
    type ArgBranch,
    type ArgTree,
} from '@cmd-hub/common'
import { IUICommandDescriptor } from '../../../../ui/types'
import { StateSnaper, type StateSnap } from './state-span'
import { CBLexerToken } from './lexer'
import log from '../../../../application/logger'
import type { SavedSources } from '../../saved-sources'

/**
 * Tree-native command builder parser. State at any moment:
 *
 *   - `path: string[]` — current branch position. `[]` is root.
 *   - `pending: { leafPath } | null` — leaf awaiting a value (positional
 *     or pair). `null` while idle / browsing branches / after a toggle.
 *   - `values: Map<string,string>` — committed leaves keyed by full
 *     slash-delimited path. Shipped verbatim as the proto `args` map,
 *     slice prefixes (`args/`, `intercom/`) included.
 *
 * Token interpretation (against the tree, one branch level at a time):
 *
 *   - DOUBLE_DASH `<name>` — descend into branch child or click leaf child.
 *   - SINGLE_DASH `<name>` — toggle a `standalone:true` leaf at the branch.
 *   - TEXT — descend into a child branch by name, commit a pending value,
 *     or auto-bind to the next unfilled positional at root.
 */

/** Discrete actions the parser emits per token. The interpreter base
 *  layer maps these to user-visible status messages and to the
 *  `done`/`compiled` resolution.
 *
 *  Vocabulary is intentionally small; legacy strings (`set-pair-name`,
 *  `ctx-switch`, `wait-next-inited`, etc.) are gone — the new model
 *  doesn't need them. */
export type ParserPerformedAction =
    | 'none'
    /** User stepped into a branch (descend) or up out of one (ascend).
     *  `pair-descend` is preserved as the spelling because the
     *  interpreter's "no-op markup refresh" reaction is identical. */
    | 'pair-descend'
    /** User clicked a leaf that needs a value; parser is now in
     *  `pending` and awaits the next TEXT token. */
    | 'await-value'
    /** A leaf value was committed (positional or pair). */
    | 'commit-leaf'
    /** A standalone leaf toggled on. */
    | 'toggle-on'
    /** A standalone leaf toggled off. */
    | 'toggle-off'

export type Pending = { readonly leafPath: readonly string[] } | null

export interface ICBParserStateRaw {
    readonly command: string
    readonly tree: ArgTree
    readonly path: readonly string[]
    readonly pending: Pending
    /** Snapshot copy of committed values (slash-delimited path → string). */
    readonly values: ReadonlyMap<string, string>
}

export interface PChainReq {
    readonly tkn: CBLexerToken
}

export interface CBParserConfig {
    command: string
    descriptor: IUICommandDescriptor
}

export class CBParser<PChainResGType extends ParserPerformedAction | string = ParserPerformedAction> {
    private readonly _command: string
    private readonly _tree: ArgTree
    /** Wire-prefix slice from the descriptor. Prepended to every
     *  `effectiveValues` key when set; undefined for one-shot / built-in
     *  commands whose values ride bare on the wire. The user-facing
     *  tree is flat — there is no `args` or `intercom` child to descend
     *  into. */
    private readonly _slice: 'args' | 'intercom' | undefined
    private _path: string[] = []
    private _pending: Pending = null
    private _values = new Map<string, string>()
    private _savedSources?: SavedSources

    private snaper = new StateSnaper()
    private tknParseChain = new Chain<PChainReq, PChainResGType>()
    private chainDirty = true

    /** Cached completion flags for `isRequiredArgumentsRead` /
     *  `isEveryArgumentsRead`. Recomputed lazily; invalidated whenever
     *  `_values` mutates (commit, toggle, focus, seed, restore). */
    private _readFlags?: { required: boolean; every: boolean }

    constructor(config: CBParserConfig) {
        this._command = config.command
        this._tree = config.descriptor.tree
        this._slice = config.descriptor.slice
        log.trace(`Parser created for command: ${this._command} slice=${this._slice ?? 'none'}`)
    }

    /* -- chain composition: custom handlers fire BEFORE the built-in ones */

    private readonly _appliedHandlers: IChainHandler<PChainReq, PChainResGType>[] = []
    public applyHandler(handler: IChainHandler<PChainReq, PChainResGType>): void {
        this._appliedHandlers.push(handler)
        this.chainDirty = true
    }

    private buildChain(): void {
        this.tknParseChain = new Chain<PChainReq, PChainResGType>()

        // Empty-token guard.
        const guardEmpty = chainHandlerFactory<PChainReq, PChainResGType>((req) => {
            if (req.tkn.value === undefined || req.tkn.value === null) {
                return 'none' as PChainResGType
            }
            return
        })

        // If we're awaiting a value (positional or pair), any TEXT token
        // commits as that value. DOUBLE_DASH/SINGLE_DASH while pending
        // means the user changed their mind — drop the pending and let
        // later handlers re-interpret the token as a fresh navigation.
        const handlePending = chainHandlerFactory<PChainReq, PChainResGType>((req) => {
            if (!this._pending) return
            const { tkn } = req
            if (tkn.type === 'TEXT') {
                this.commitLeaf(this._pending.leafPath, tkn.value!)
                this._pending = null
                return 'commit-leaf' as PChainResGType
            }
            // User pivoted — abandon pending and fall through.
            this._pending = null
            return
        })

        // SINGLE_DASH always means "toggle a standalone leaf at the
        // current branch."
        const handleStandalone = chainHandlerFactory<PChainReq, PChainResGType>((req) => {
            const { tkn } = req
            if (tkn.type !== 'SINGLE_DASH') return
            let node = this.childOfCurrentBranch(tkn.value!)
            // At root, allow `-flag` to deep-resolve to a unique leaf
            // anywhere in the tree (hybrid deep search). Same fallback
            // as DOUBLE_DASH navigation.
            if (!node && this._path.length === 0) {
                const match = this.findInTree(tkn.value!)
                if (match) {
                    // Descend through every branch on the path so the
                    // markuper renders the destination correctly.
                    this._path = match.pathToParent.slice()
                    node = match.node
                    log.debug(`SINGLE_DASH "${tkn.value}" deep-resolved to ${[...match.pathToParent, tkn.value].join(ARG_PATH_DELIMITER)}`)
                }
            }
            if (!node || node.node !== 'leaf' || !node.standalone) {
                log.debug(`SINGLE_DASH "${tkn.value}" — child is not a standalone leaf`)
                return 'none' as PChainResGType
            }
            return this.toggleStandalone(tkn.value!) as PChainResGType
        })

        // DOUBLE_DASH at the current branch level: descend into a child
        // branch, toggle a child standalone, or click a child pair-leaf
        // (enter `pending`).
        const handleDoubleDash = chainHandlerFactory<PChainReq, PChainResGType>((req) => {
            const { tkn } = req
            if (tkn.type !== 'DOUBLE_DASH') return
            return this.handleNavigationToken(tkn.value!) as PChainResGType
        })

        // Plain TEXT navigation:
        //   1. names a child of the current branch — descend / toggle /
        //      enter pending, same as DOUBLE_DASH.
        //   2. otherwise — only when the user is at root — auto-bind to
        //      the next unfilled positional leaf. This is what makes
        //      `interpreter.step('scraper')` (non-mandatory mode) bind
        //      a bare argument to its positional slot. Mid-branch we
        //      don't want to silently steal a positional from elsewhere
        //      in the tree, so the auto-bind only fires at the root.
        //   3. otherwise: nothing to do.
        const handleText = chainHandlerFactory<PChainReq, PChainResGType>((req) => {
            const { tkn } = req
            if (tkn.type !== 'TEXT') return
            const navResult = this.handleNavigationToken(tkn.value!)
            if (navResult !== null) return navResult as PChainResGType

            if (this._path.length === 0) {
                const positional = this.nextUnfilledPositional()
                if (positional) {
                    this.commitLeaf(positional.path, tkn.value!)
                    return 'commit-leaf' as PChainResGType
                }
            }
            return 'none' as PChainResGType
        })

        for (const hndl of this._appliedHandlers) this.tknParseChain.use(hndl)
        this.tknParseChain.use(guardEmpty)
        this.tknParseChain.use(handlePending)
        this.tknParseChain.use(handleStandalone)
        this.tknParseChain.use(handleDoubleDash)
        this.tknParseChain.use(handleText)
        this.tknParseChain.use(createChainFallbackHandler<PChainReq, PChainResGType>('none' as PChainResGType))
    }

    /* -- value commit ----------------------------------------------- */

    private commitLeaf(leafPath: readonly string[], rawValue: string): void {
        const key = leafPath.join(ARG_PATH_DELIMITER)
        this._values.set(key, rawValue)
        this._readFlags = undefined
    }

    /** Resolve a navigation token (TEXT or DOUBLE_DASH naming a child of
     *  the current branch) to its action. Returns `null` when the token
     *  doesn't name a child — TEXT callers fall back to positional
     *  auto-bind, DOUBLE_DASH callers report `'none'`.
     *
     *  At root, if `name` doesn't name an immediate child but DOES name
     *  a UNIQUE node anywhere in the tree, we descend through every
     *  branch on the path to it before resolving. This lets a CLI user
     *  type `/scraper Адвокат --baseUrl http://...` without having to
     *  know that `baseUrl` lives under `aiAgent/`. Ambiguous names
     *  (two leaves with the same name in different branches) return
     *  `null` — the user must drill explicitly. */
    private handleNavigationToken(name: string): ParserPerformedAction | null {
        let node = this.childOfCurrentBranch(name)
        if (!node && this._path.length === 0) {
            const match = this.findInTree(name)
            if (match) {
                this._path = match.pathToParent.slice()
                node = match.node
                log.debug(`navigation "${name}" deep-resolved to ${[...match.pathToParent, name].join(ARG_PATH_DELIMITER)}`)
            }
        }
        if (!node) {
            log.debug(`navigation "${name}" — no matching child of branch [${this._path.join('/')}]`)
            return null
        }
        if (node.node === 'branch') {
            this._path.push(name)
            return 'pair-descend'
        }
        if (node.standalone) {
            return this.toggleStandalone(name)
        }
        this._pending = { leafPath: [...this._path, name] }
        return 'await-value'
    }

    /** Hybrid deep search at root: walk the entire tree for nodes named
     *  `name` (excluding the current branch's immediate children, which
     *  the caller already checked). Returns `undefined` when the name
     *  matches zero or 2+ nodes. When exactly one match exists, returns
     *  the path-to-parent (so the caller can set `_path` to it) and the
     *  matched node.
     *
     *  Only the caller decides when to invoke this — the design is
     *  "root-only" so a partially-drilled user doesn't accidentally
     *  jump out of their current branch. */
    private findInTree(name: string): { pathToParent: string[]; node: ArgTree } | undefined {
        const matches: { pathToParent: string[]; node: ArgTree }[] = []
        const visit = (branch: ArgBranch, pathToBranch: string[]): void => {
            for (const [childName, child] of branch.children) {
                if (childName === name) {
                    matches.push({ pathToParent: pathToBranch.slice(), node: child })
                    if (matches.length > 1) return
                }
                if (child.node === 'branch') {
                    visit(child, [...pathToBranch, childName])
                    if (matches.length > 1) return
                }
            }
        }
        if (this._tree.node === 'branch') visit(this._tree, [])
        if (matches.length === 1) return matches[0]
        if (matches.length > 1) {
            log.debug(`findInTree "${name}" — ambiguous (${matches.length} matches), refusing to deep-resolve`)
        }
        return undefined
    }

    /** Toggle a `standalone:true` leaf at the current branch level.
     *  Stored as `'true'` so `unflattenArgs(type:'bool')` coerces to
     *  `true` and `proxy.has()` reports the flag as set. */
    private toggleStandalone(name: string): ParserPerformedAction {
        const key = [...this._path, name].join(ARG_PATH_DELIMITER)
        this._readFlags = undefined
        if (this._values.has(key)) {
            this._values.delete(key)
            return 'toggle-off'
        }
        this._values.set(key, 'true')
        return 'toggle-on'
    }

    /* -- tree lookups ------------------------------------------------ */

    /** Read-only view of the tree node at the parser's current path.
     *  Markupers render this node's children (for branches) or its
     *  options/prompt (for leaves on a focused re-prompt). */
    nodeAtCurrent(): ArgTree | undefined {
        return argNodeAtPath(this._tree, this._path)
    }

    private currentBranch(): ArgBranch | undefined {
        const node = argNodeAtPath(this._tree, this._path)
        if (!node || node.node !== 'branch') return undefined
        return node
    }

    private childOfCurrentBranch(name: string): ArgTree | undefined {
        const branch = this.currentBranch()
        if (!branch) return undefined
        return branch.children.get(name)
    }

    /* -- re-prompt support (ValidationFailed flow) ------------------- */

    /** Replace the committed values map. Used by the dispatcher when a
     *  node-side `ValidationFailed` event arrives: the dispatcher restores
     *  the previously parsed values and then `focusLeaf`s the failed leaf
     *  so the markuper renders only that leaf's prompt. */
    seedValues(values: ReadonlyMap<string, string>): void {
        this._values = new Map(values)
        this._pending = null
        this._path = []
        this._readFlags = undefined
        // Discard undo history — the seeded state is the new baseline.
        this.snaper = new StateSnaper()
    }

    /** Position the parser as if the user just clicked the leaf at
     *  `leafPath`. The path drills to the leaf's parent branch and
     *  pending is set to the leaf, so the next TEXT token commits.
     *  No-op when `leafPath` doesn't resolve to a leaf in the tree. */
    focusLeaf(leafPath: readonly string[]): boolean {
        if (leafPath.length === 0) return false
        const target = argNodeAtPath(this._tree, leafPath)
        if (!target || target.node !== 'leaf') return false
        this._path = leafPath.slice(0, -1)
        // Drop any in-progress committed value for that leaf so the
        // user's next input replaces it; pending is a re-prompt marker.
        this._values.delete(leafPath.join(ARG_PATH_DELIMITER))
        this._pending = { leafPath: [...leafPath] }
        this._readFlags = undefined
        return true
    }

    /** Walk every leaf and return the lowest-position positional whose
     *  value isn't yet committed. Used by non-mandatory mode to bind a
     *  bare TEXT token to "the next positional." */
    private nextUnfilledPositional(): { path: string[]; leaf: ArgLeaf } | undefined {
        let best: { path: string[]; leaf: ArgLeaf } | undefined
        for (const { path, pathKey, leaf } of walkArgLeaves(this._tree)) {
            if (leaf.position <= 0) continue
            if (this._values.has(pathKey)) continue
            if (!best || leaf.position < best.leaf.position) {
                best = { path, leaf }
            }
        }
        return best
    }

    /* -- snapshot ---------------------------------------------------- */

    private snap(): void {
        this.snaper.memorize({
            path: [...this._path],
            pending: this._pending ? { leafPath: [...this._pending.leafPath] } : null,
            values: new Map(this._values),
        })
    }

    private restore(snap: StateSnap): void {
        this._path = [...snap.path]
        this._pending = snap.pending ? { leafPath: [...snap.pending.leafPath] } : null
        this._values = new Map(snap.values)
        this._readFlags = undefined
    }

    /** Step back one parsed token. Returns `false` when no prior state
     *  is available (interpreter falls back to a hard cancel-op). */
    public back(): boolean {
        const prev = this.snaper.back
        if (!prev) return false
        this.restore(prev)
        return true
    }

    /** Step up one branch level. Used by the interpreter's cancel-op
     *  reaction so the user can back out of a branch they've drilled
     *  into without bailing the whole build. Returns `false` at root. */
    public ascend(): boolean {
        if (this._path.length === 0) return false
        this._path.pop()
        return true
    }

    /* -- public read API --------------------------------------------- */

    get Command(): string {
        return this._command
    }
    get Tree(): ArgTree {
        return this._tree
    }
    get Path(): readonly string[] {
        return this._path
    }
    get Pending(): Pending {
        return this._pending
    }
    /** Read-only view of committed values. Markuper / interpreter use
     *  this to render checkmarks beside already-set leaves and to
     *  decide when "all required filled" goals are reached. */
    get Values(): ReadonlyMap<string, string> {
        return this._values
    }

    get SavedSources(): SavedSources | undefined {
        return this._savedSources
    }
    set SavedSources(data: SavedSources | undefined) {
        this._savedSources = data
    }

    /** Compile-time view: user-committed values overlaid with saved
     *  values for any leaf the user did not commit. Used by the
     *  interpreter's compile path so saved values fill gaps without
     *  appearing as user input in the markup.
     *
     *  Wire-prefix reapply: when the descriptor carries a `slice`
     *  (`'args'` or `'intercom'`), every emitted key is prefixed with
     *  `${slice}/`. The parser's internal storage uses bare paths
     *  relative to the user-facing tree; the prefix lives at this
     *  boundary so transport / storage / node-side routing
     *  (`sliceArgsByPrefix` in `cmd-node-app.ts`) keep their
     *  slice-namespaced view. One-shot / built-in commands have no
     *  slice and emit bare keys.
     *
     *  Insertion order: user values FIRST so `CmdArgumentProxy._byLastSegment`
     *  resolves bare names to user input on collision (Map preserves insertion
     *  order, the proxy's last-segment index uses first-write-wins).
     *
     *  `now` is the hub-side "skip the builder" flag — it must never
     *  ride the wire (the dispatcher already stripped the `-now` token
     *  pre-build, but a builder-side toggle could still commit it). Drop
     *  it here so neither the proxy nor the wire `args` map sees it. */
    effectiveValues(): Map<string, string> {
        const slicePrefix = this._slice ? `${this._slice}${ARG_PATH_DELIMITER}` : ''
        const emit = (out: Map<string, string>, k: string, v: string): void => {
            if (k === 'now') return
            out.set(`${slicePrefix}${k}`, v)
        }
        const out = new Map<string, string>()
        for (const [k, v] of this._values) {
            emit(out, k, v)
        }
        if (this._savedSources) {
            for (const [k, entry] of this._savedSources) {
                if (k === 'now') continue
                const wireKey = `${slicePrefix}${k}`
                if (out.has(wireKey)) continue
                out.set(wireKey, entry.value)
            }
        }
        return out
    }

    /** A flat snapshot of internal state. Markuper uses this to render
     *  text + buttons, and the interpreter passes it to `EvaluationResult`. */
    toRawState(): ICBParserStateRaw {
        return {
            command: this._command,
            tree: this._tree,
            path: [...this._path],
            pending: this._pending ? { leafPath: [...this._pending.leafPath] } : null,
            values: new Map(this._values),
        }
    }

    /* -- "is X read" helpers (interpreter modes consume these) ------ */

    /** True when every `required:true` leaf has a committed value.
     *  Required-mode interpreters compile as soon as this trips. */
    isRequiredArgumentsRead(): boolean {
        return this._readFlagsCached().required
    }

    /** True when every leaf has a committed value. Comprehensive-mode
     *  interpreters compile when this trips. */
    isEveryArgumentsRead(): boolean {
        return this._readFlagsCached().every
    }

    private _readFlagsCached(): { required: boolean; every: boolean } {
        if (this._readFlags) return this._readFlags
        let required = true
        let every = true
        for (const { pathKey, leaf } of walkArgLeaves(this._tree)) {
            const v = this._values.get(pathKey)
            const set = v !== undefined && v !== ''
            if (!set) {
                every = false
                if (leaf.required) required = false
            }
        }
        this._readFlags = { required, every }
        return this._readFlags
    }

    get IsTreeEmpty(): boolean {
        if (this._tree.node === 'leaf') return false
        return this._tree.children.size === 0
    }

    /* -- entry point ------------------------------------------------- */

    parseNextToken(tkn: CBLexerToken): PChainResGType {
        if (this.chainDirty) {
            this.buildChain()
            this.chainDirty = false
        }
        this.snap()
        return this.tknParseChain.handle({ tkn })
    }
}

