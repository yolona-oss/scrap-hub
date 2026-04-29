import TypedEventEmitter, { EventMap } from 'typed-emitter'
import EventEmitter from 'events'

import { IRunnable } from "../types/runnable"

import { BLANK_SERVICE_NAME } from "./service-constants"
import { ServiceContext } from "./service-context"
import {
    IServiceStore,
    IServiceAccountLayer,
    IServiceSessionLayer,
    DEFAULT_ACCOUNT_SESSION_NAME,
    DEFAULT_SESSION_EXPIRITY_MS
} from "./service-store"

import {
    GlobalServiceArgs,
    GlobalServiceIntercom,
    CmdServiceData,
} from "./service-data"

import type { UiMessage } from "../ui-message/types"
import {
    CMD_ARG_META_KEY,
    buildArgTreeFromClass,
    defineDecoratorMeta,
    readDecoratorMeta,
} from "../command"
import type { ArgTree, ArgBranch } from "../command/tree"
import { argBranch, walkArgLeaves, flattenArgs, unflattenArgs } from "../command/tree"

/** Keys under `sessionLayer.data` for the two parallel slices the
 *  layered model writes to: per-session args overlay and resumable
 *  state. Centralized so callers don't sprinkle string literals. */
const SESSION_ARGS_KEY = 'args'
const SESSION_STATE_KEY = 'state'

/** Build a dot-separated subfield path (e.g. `args.foo.bar`) from a
 *  top-level slice + optional sub-path. Empty sub-path returns just
 *  the slice key — used by `replaceArgs`-style whole-object writes. */
function joinFieldPath(slice: string, sub: string): string {
    return sub.length > 0 ? `${slice}.${sub}` : slice
}

/** Standalone-arg flags arrive as `true` after the wire-side bool
 *  coercion (`unflattenValue` resolves the `'true'` string the parser
 *  stores) or as the literal string `'true'` when the leaf type stays
 *  the default `'string'`. Both shapes count as set. */
function isFlagSet(v: unknown): boolean {
    return v === true || v === 'true'
}

/** Merge a global-args class with the user-supplied slice instance into
 *  a single root branch. User-specific keys win on collision. The slice
 *  is read off the instance's constructor so the prototype chain walk
 *  in `buildArgTreeFromClass` includes its decorator-bag. */
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

export interface IntercomAction {
    id: string
    label: string
    icon?: string
    args?: string[]
}

/**
 * Typed event map for BaseCommandService. Subclasses get autocomplete +
 * type-check on every emit/on. The node-side invoke adapter reads all of
 * them off the emitter and forwards them as proto InvokeServer messages.
 *
 * Every user-facing message — text, errors, structured payloads, source
 * failures — rides the unified `uiMessage` channel as a `UiMessage`
 * envelope. Domain-specific kinds (e.g. `'sourceFailed'`, `'org'`) are
 * registered as plugin-augmented kinds via `Application.useUiMessageKind`.
 */
export interface IBaseCmdService_EvMap extends EventMap {
    done: (msg?: string) => void,
    liveLog: (logs: string[]) => void,
    progress: (name: string, current: number, total: number) => void,
    progressStatus: (name: string, status: string) => void,
    intercom: (actions: IntercomAction[]) => void,
    file: (handleOrPath: unknown) => void,
    /** Structured user-facing message. Services emit via `send(msg)` —
     *  `sendToWorld`/`sendToError` are typed-text shortcuts that go
     *  through the same channel. */
    uiMessage: (msg: UiMessage) => void,
}

/** Shape-agnostic decorator-meta bag. The new `@CmdArg` stores
 *  per-property entries that describe leaf or branch nodes; `merge()`
 *  doesn't care about the shape, it just unions the keys so the merged
 *  instance still answers `buildArgTreeFromClass`. */
type DecoratorMetaBag = Record<string, unknown>

function merge<T extends Object>(dst: T, src: T): T {
    const merged = Object.create(Object.getPrototypeOf(dst));

    Object.assign(merged, dst, src);

    const dst_meta = readDecoratorMeta<DecoratorMetaBag>(CMD_ARG_META_KEY, dst);
    if (dst_meta) {
        defineDecoratorMeta(CMD_ARG_META_KEY, merged, dst_meta);
    }

    const src_meta = readDecoratorMeta<DecoratorMetaBag>(CMD_ARG_META_KEY, src);
    if (src_meta) {
        const existing = readDecoratorMeta<DecoratorMetaBag>(CMD_ARG_META_KEY, merged) ?? {};
        defineDecoratorMeta(CMD_ARG_META_KEY, merged, { ...existing, ...src_meta });
    }

    return merged;
}

/**
 * Base class for command services
 * @template ServiceDataType - Type of service data not extended from base. See {@link CmdServiceData}
 */
export abstract class BaseCommandService<ServiceDataType extends CmdServiceData<any, any, any>>
    extends (EventEmitter as new () => TypedEventEmitter<IBaseCmdService_EvMap>)
    implements IRunnable
{
    private static _store: IServiceStore | null = null
    /** Wire once at app bootstrap. Hub sets a MongoServiceStore; node may set its own. */
    public static setStore(store: IServiceStore): void {
        BaseCommandService._store = store
    }
    /** Test-only escape hatch; safe to call from beforeEach to avoid cross-test pollution. */
    public static __resetStoreForTests(): void {
        BaseCommandService._store = null
    }
    private static requireStore(): IServiceStore {
        if (!BaseCommandService._store) {
            throw new Error('BaseCommandService has no store configured. Call BaseCommandService.setStore(...) during app bootstrap before any service runs.')
        }
        return BaseCommandService._store
    }

    private _isInited = false
    private _isRunning: boolean = false
    private _cachedAccountLayer: IServiceAccountLayer | null = null
    private _cachedSessionLayer: IServiceSessionLayer | null = null
    private _intercomActions: IntercomAction[] = []

    protected data: ServiceDataType

    /** Read-only snapshot of the service's runtime data. The dispatcher's
     *  `/sinfo` built-in reads this to render runtime args / state panels.
     *  External callers must not mutate; subclasses still have direct
     *  protected access via `this.data`. */
    get snapshot(): Readonly<ServiceDataType> { return this.data }

    constructor(
        protected userId: string,
        private defaultData: ServiceDataType,
        protected inputServiceData: Partial<ServiceDataType>,
        public readonly name: string = BLANK_SERVICE_NAME,
    ) {
        super()
        this.data = defaultData
        const g_args     = new GlobalServiceArgs()
        const g_intercom = new GlobalServiceIntercom()

        this.data.args     = merge(this.data.args, g_args)
        this.data.intercom = merge(this.data.intercom, g_intercom)
    }

    protected abstract runWrapper(): Promise<void>
    protected abstract terminateWrapper(): Promise<void>
    abstract receiveMsg(msg: string, args: string[]): Promise<void>
    abstract clone(userId: string, input?: Partial<ServiceDataType>, newName?: string): BaseCommandService<ServiceDataType>

    /** Emit a structured `UiMessage` to the dashboard / connected UIs.
     *  The `kind` field is what the UI uses to pick a per-platform
     *  renderer. For free-form text, use `sendToWorld` / `sendToError`
     *  which are thin wrappers that build a `{kind:'text'}` envelope. */
    protected send(msg: UiMessage) {
        this.emit("uiMessage", msg)
    }

    protected sendToWorld(text: string) {
        this.send({ kind: 'text', text })
    }

    protected sendToError(text: string) {
        this.send({ kind: 'text', text, severity: 'error' })
    }

    /**
     * Register a custom action button on the dashboard.
     * The button click triggers receiveMsg(action.id, action.args ?? []).
     */
    protected registerIntercom(action: IntercomAction): void {
        const existing = this._intercomActions.findIndex(a => a.id === action.id)
        if (existing >= 0) {
            this._intercomActions[existing] = action
        } else {
            this._intercomActions.push(action)
        }
        this.emit('intercom', [...this._intercomActions])
    }

    protected removeIntercom(actionId: string): void {
        this._intercomActions = this._intercomActions.filter(a => a.id !== actionId)
        this.emit('intercom', [...this._intercomActions])
    }

    get intercomActions(): ReadonlyArray<IntercomAction> {
        return this._intercomActions
    }

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

    protected createServicePrefix() {
        return `${this.name}-${this.data.sessionId}-${this.userId}`
    }

    public get SessionId() {
        return this.data.sessionId
    }

    get isBlankSession() {
        return this.data.sessionId === DEFAULT_ACCOUNT_SESSION_NAME
    }

    isRunning(): boolean {
        return this._isRunning
    }

    /** Tree of args (global ⊕ service-specific). Branch descendants in
     *  the service-specific class win on key collision. */
    argsTree(): ArgTree {
        return mergeTrees(GlobalServiceArgs, this.data.args)
    }

    intercomTree(): ArgTree {
        return mergeTrees(GlobalServiceIntercom, this.data.intercom)
    }

    toString() {
        return `_${this.name}_-_${this.data.sessionId}_`
    }

    async Initialize(): Promise<void> {
        if (this._isInited) {
            throw new Error(`Service already initialized`)
        }

        try {
            await this.initSession()
        } catch (e) {
            const msg = e instanceof Error ? e.message : e
            throw new Error(`Service initialization error:\n-- ${msg}`)
        }

        this._isInited = true
        console.info(`Service "${this.toString()}" initialized`)
    }

    private async retrieveAccountData(forceRefresh = false) {
        if (!forceRefresh && this._cachedAccountLayer && this._cachedSessionLayer) {
            return {
                accountLayer: this._cachedAccountLayer,
                sessionLayer: this._cachedSessionLayer,
                accountLayerData: this._cachedAccountLayer.data,
                sessionLayerData: this._cachedSessionLayer.data,
            }
        }

        const store = BaseCommandService.requireStore()
        const desiredSessionId = this.data.sessionId
        const { accountLayer, sessionLayer } = await store.load({
            userId: this.userId,
            serviceName: this.name,
            desiredSessionId,
            defaultExpirityMs: DEFAULT_SESSION_EXPIRITY_MS,
            incrementalExpirity: true,
        })

        this._cachedAccountLayer = accountLayer
        this._cachedSessionLayer = sessionLayer

        return {
            accountLayer,
            sessionLayer,
            accountLayerData: accountLayer.data,
            sessionLayerData: sessionLayer.data,
        }
    }

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

        // `noCache` is the per-run escape hatch: skip overlay reads AND
        // skip the session-layer write so saved values survive untouched.
        const noCache = isFlagSet(inputArgs['noCache'])

        // Walk the args tree to learn which leaves are persistent vs. ephemeral.
        // Persistent leaves take part in the layered merge AND get written back
        // to the session layer. Ephemeral leaves come from input (or default)
        // only — they never touch the store.
        const tree = this.argsTree()
        const persistentPaths = new Set<string>()
        const ephemeralPaths = new Set<string>()
        for (const { pathKey, leaf } of walkArgLeaves(tree)) {
            if (leaf.persistent) persistentPaths.add(pathKey)
            else ephemeralPaths.add(pathKey)
        }

        // Project nested-object inputs through the tree to flat dot-path maps,
        // then filter each by which paths are persistent vs ephemeral.
        const flatDefaults = flattenArgs(tree, defaultData.args)
        const flatInput = flattenArgs(tree, inputArgs)
        const flatAccount = noCache
            ? new Map<string, string>()
            : flattenArgs(tree, accountLayerData[SESSION_ARGS_KEY] ?? {})
        const flatSession = noCache
            ? new Map<string, string>()
            : flattenArgs(tree, sessionLayerData[SESSION_ARGS_KEY] ?? {})

        const filterMap = (m: Map<string, string>, allowed: Set<string>): Map<string, string> => {
            const out = new Map<string, string>()
            for (const [k, v] of m) if (allowed.has(k)) out.set(k, v)
            return out
        }

        // Persistent slice: defaults ← account ← session ← input
        const mergedPersistent = new Map<string, string>()
        for (const m of [
            filterMap(flatDefaults, persistentPaths),
            filterMap(flatAccount, persistentPaths),
            filterMap(flatSession, persistentPaths),
            filterMap(flatInput, persistentPaths),
        ]) {
            for (const [k, v] of m) mergedPersistent.set(k, v)
        }

        // Ephemeral slice: defaults ← input only
        const mergedEphemeral = new Map<string, string>()
        for (const m of [
            filterMap(flatDefaults, ephemeralPaths),
            filterMap(flatInput, ephemeralPaths),
        ]) {
            for (const [k, v] of m) mergedEphemeral.set(k, v)
        }

        const allMerged = new Map<string, string>([...mergedPersistent, ...mergedEphemeral])
        const aArgs = unflattenArgs(tree, allMerged) as Record<string, unknown>

        // State (resumable runtime state) — unchanged from the rename-only pass.
        const existingState = (sessionLayerData[SESSION_STATE_KEY] ?? {}) as Record<string, unknown>
        let aState: Record<string, unknown> = existingState
        const initState = !aState || Object.keys(aState).length === 0
        if (initState) {
            aState = {
                ...defaultData.state,
                ...((inputData as any).state ?? {}),
            } as Record<string, unknown>
        }

        // Writes go to the session layer (the writable overlay); account
        // stays as the long-lived baseline that only `/sargs` touches.
        // Sequential, not parallel — the Mongo adapter saves the same
        // Mongoose document each call, and Mongoose rejects concurrent
        // `save()` on a single doc with "Can't save() the same doc multiple
        // times in parallel".
        if (!noCache) {
            // Persist ONLY the persistent slice; the session layer must not
            // accumulate ephemeral knobs.
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

    /** Persist an arg field. Writes go to the **session layer** so the
     *  account baseline (set via `/sargs`) stays untouched. */
    protected async setArgValue(path: string, value: any) {
        const { sessionLayer } = await this.retrieveAccountData()
        await sessionLayer.setField(joinFieldPath(SESSION_ARGS_KEY, path), value)
    }

    /** Persist a state field (resumable per-session state, e.g.
     *  scraper progress). Distinct from args. */
    protected async setStateValue(path: string, value: any) {
        const { sessionLayer } = await this.retrieveAccountData()
        await sessionLayer.setField(joinFieldPath(SESSION_STATE_KEY, path), value)
    }

    /** Persist multiple state fields in one DB round-trip. Use this
     *  over consecutive `setStateValue` calls — the underlying
     *  Mongoose doc rejects parallel `save()`s, and back-to-back awaits
     *  multiply the round-trip cost. The `updates` keys are dot-paths
     *  relative to `state`. */
    protected async setState(updates: Record<string, unknown>): Promise<void> {
        const { sessionLayer } = await this.retrieveAccountData()
        const prefixed: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(updates)) {
            prefixed[joinFieldPath(SESSION_STATE_KEY, k)] = v
        }
        await sessionLayer.setFields(prefixed)
    }

    async run(): Promise<void> {
        if (!this._isInited) {
            throw new Error(`Service not initialized`)
        }
        if (this.isRunning()) {
            throw new Error(`Service already running`)
        }

        this._isRunning = true

        await this.runWrapper()

        // If runWrapper finishes naturally (not via terminate()), auto-terminate
        if (this._isRunning) {
            await this.terminate()
        }
    }

    async terminate(): Promise<void> {
        await this.terminateWrapper()
        this._isRunning = false
        this.emit("done")
    }
}
