import 'reflect-metadata'

import { BaseCommandService } from '../base-command-service'
import { CmdServiceData, GlobalServiceArgs, GlobalServiceIntercom } from '../service-data'
import {
    IServiceStore,
    IServiceAccountLayer,
    IServiceSessionLayer,
    IServiceStoreLoadResult,
    DEFAULT_ACCOUNT_SESSION_NAME,
} from '../service-store'
import { assignToCustomPath } from '../../utils/object'
import { CmdArg } from '../../command'

// ---------------------------------------------------------------------------
// Shared test infrastructure
// ---------------------------------------------------------------------------

class FakeAccountLayer implements IServiceAccountLayer {
    public data: Record<string, unknown> = {}
    public writes: Array<{ path: string; value: unknown }> = []

    async setField(path: string, value: unknown): Promise<void> {
        this.writes.push({ path, value })
        assignToCustomPath(this.data, path, value)
    }

    async replaceArgs(args: Record<string, unknown>): Promise<void> {
        this.data.args = args
    }
}

class FakeSessionLayer implements IServiceSessionLayer {
    public data: Record<string, unknown> = {}
    public writes: Array<{ path: string; value: unknown }> = []
    /** Counts saves performed; one entry per `setField` or `setFields` call. */
    public saveCount = 0

    constructor(public readonly name: string) {}

    async setField(path: string, value: unknown): Promise<void> {
        this.writes.push({ path, value })
        assignToCustomPath(this.data, path, value)
        this.saveCount++
    }

    async setFields(updates: Record<string, unknown>): Promise<void> {
        for (const [path, value] of Object.entries(updates)) {
            this.writes.push({ path, value })
            assignToCustomPath(this.data, path, value)
        }
        this.saveCount++
    }

    async replaceData(data: Record<string, unknown>): Promise<void> {
        this.data = data
        this.saveCount++
    }
}

class FakeStore implements IServiceStore {
    constructor(
        public readonly accountLayer: FakeAccountLayer,
        public readonly sessionLayer: FakeSessionLayer,
    ) {}

    async load(): Promise<IServiceStoreLoadResult> {
        return { accountLayer: this.accountLayer, sessionLayer: this.sessionLayer }
    }
}

// ---------------------------------------------------------------------------
// Args class used by layered-merge tests: a, b, c are persistent leaves so
// they participate in the account ← session ← input overlay chain.
// ---------------------------------------------------------------------------
class LayerTestArgs extends GlobalServiceArgs {
    @CmdArg({ persistent: true, description: 'test leaf a' })
    a?: number

    @CmdArg({ persistent: true, description: 'test leaf b' })
    b?: number

    @CmdArg({ persistent: true, description: 'test leaf c' })
    c?: number
}

type LayerTestData = CmdServiceData<LayerTestArgs, GlobalServiceIntercom, {}>

class LayerTestService extends BaseCommandService<LayerTestData> {
    constructor(userId: string, input: Partial<LayerTestData> = {}) {
        super(userId, new CmdServiceData(new LayerTestArgs(), new GlobalServiceIntercom()), input, 'layer-test-svc')
    }
    clone(userId: string, inputData?: Partial<LayerTestData>) {
        return new LayerTestService(userId, inputData)
    }
    protected async runWrapper(): Promise<void> {}
    protected async terminateWrapper(): Promise<void> {}
    async receiveMsg(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// Plain TestService (GlobalServiceArgs only) — used for setArgValue / setState
// ---------------------------------------------------------------------------
class TestServiceData extends CmdServiceData<GlobalServiceArgs, GlobalServiceIntercom, {}> {
    constructor() {
        super(new GlobalServiceArgs(), new GlobalServiceIntercom())
    }
}

class TestService extends BaseCommandService<TestServiceData> {
    constructor(userId: string, input: Partial<TestServiceData> = {}) {
        super(userId, new TestServiceData(), input, 'test-svc')
    }
    clone(userId: string, inputData?: Partial<TestServiceData>) {
        return new TestService(userId, inputData)
    }
    protected async runWrapper(): Promise<void> {}
    protected async terminateWrapper(): Promise<void> {}
    async receiveMsg(): Promise<void> {}
    /** Public hooks so tests can drive the protected setters. */
    public async testSetArg(path: string, value: unknown) { return this.setArgValue(path, value) }
    public async testSetStateValue(path: string, value: unknown) { return this.setStateValue(path, value) }
    public async testSetStateBatch(updates: Record<string, unknown>) { return this.setState(updates) }
}

function newScenario(opts: {
    accountArgs?: Record<string, unknown>
    sessionArgs?: Record<string, unknown>
    sessionState?: Record<string, unknown>
    sessionName?: string
} = {}) {
    const accountLayer = new FakeAccountLayer()
    if (opts.accountArgs) accountLayer.data = { args: opts.accountArgs }
    const sessionLayer = new FakeSessionLayer(opts.sessionName ?? DEFAULT_ACCOUNT_SESSION_NAME)
    sessionLayer.data = {}
    if (opts.sessionArgs) sessionLayer.data.args = opts.sessionArgs
    if (opts.sessionState) sessionLayer.data.state = opts.sessionState
    const store = new FakeStore(accountLayer, sessionLayer)
    BaseCommandService.setStore(store)
    return { store, accountLayer, sessionLayer }
}

beforeEach(() => {
    BaseCommandService.__resetStoreForTests()
})

// ---------------------------------------------------------------------------
// Layered args precedence — use LayerTestService so a/b/c are declared leaves
// ---------------------------------------------------------------------------
describe('BaseCommandService — layered args precedence', () => {
    test('session overlay overrides account baseline; input overrides session', async () => {
        const { sessionLayer } = newScenario({
            accountArgs: { a: 1, b: 1, c: 1 },
            sessionArgs: { b: 2, c: 2 },
        })
        const svc = new LayerTestService('u1', { args: { c: 3 } as any })
        await svc.Initialize()
        // a only in account → 1; b in account+session → session wins → 2; c in all three → input wins → 3
        const cfg = (svc.snapshot as any).args
        expect(cfg.a).toBe(1)
        expect(cfg.b).toBe(2)
        expect(cfg.c).toBe(3)
        // The merged result was written back to session layer (persistent keys only).
        expect(sessionLayer.data.args).toMatchObject({ a: 1, b: 2, c: 3 })
    })

    test('legacy account-only data still merges through (no session overlay yet)', async () => {
        const { sessionLayer } = newScenario({ accountArgs: { a: 1, b: 1 } })
        const svc = new LayerTestService('u1')
        await svc.Initialize()
        const cfg = (svc.snapshot as any).args
        expect(cfg).toMatchObject({ a: 1, b: 1 })
        // The merge result was persisted as a session overlay.
        expect(sessionLayer.data.args).toMatchObject({ a: 1, b: 1 })
    })
})

describe('BaseCommandService — setArgValue routes to session layer', () => {
    test('setArgValue writes to session layer, not account', async () => {
        const { accountLayer, sessionLayer } = newScenario({
            accountArgs: { existing: 'baseline' },
        })
        const svc = new TestService('u1')
        await svc.Initialize()
        accountLayer.writes.length = 0  // clear init writes
        sessionLayer.writes.length = 0

        await svc.testSetArg('newKey', 'newVal')
        expect(sessionLayer.writes).toEqual([{ path: 'args.newKey', value: 'newVal' }])
        expect(accountLayer.writes).toEqual([])
        expect(accountLayer.data.args).toEqual({ existing: 'baseline' })
    })

    test('setStateValue writes to session layer under state key', async () => {
        const { sessionLayer } = newScenario()
        const svc = new TestService('u1')
        await svc.Initialize()
        sessionLayer.writes.length = 0

        await svc.testSetStateValue('progress', 42)
        expect(sessionLayer.writes).toEqual([{ path: 'state.progress', value: 42 }])
    })

    test('setState (batched) writes all paths in a single save', async () => {
        const { sessionLayer } = newScenario()
        const svc = new TestService('u1')
        await svc.Initialize()
        sessionLayer.writes.length = 0
        const baselineSaves = sessionLayer.saveCount

        await svc.testSetStateBatch({
            results: [{ name: 'org-1' }],
            processedUrls: ['https://a.test'],
            lastQuery: 'foo',
        })

        // All three writes recorded under the state prefix.
        expect(sessionLayer.writes).toEqual([
            { path: 'state.results', value: [{ name: 'org-1' }] },
            { path: 'state.processedUrls', value: ['https://a.test'] },
            { path: 'state.lastQuery', value: 'foo' },
        ])
        // Exactly ONE save() across the batch — the whole point of the API.
        expect(sessionLayer.saveCount - baselineSaves).toBe(1)
    })
})

// ---------------------------------------------------------------------------
// noCache bypass — use LayerTestService so a/b/c are in the tree
// ---------------------------------------------------------------------------
describe('BaseCommandService — noCache bypass', () => {
    test('noCache=true skips overlay reads AND skips session-layer write', async () => {
        const { sessionLayer } = newScenario({
            accountArgs: { a: 1 },
            sessionArgs: { a: 2, b: 2 },
        })
        const svc = new LayerTestService('u1', {
            args: { c: 3, noCache: true } as any,
        })
        await svc.Initialize()
        const cfg = (svc.snapshot as any).args
        // Saved values were skipped; only defaults + input apply.
        expect(cfg.a).toBeUndefined()
        expect(cfg.b).toBeUndefined()
        expect(cfg.c).toBe(3)
        // Session overlay was NOT written — saved values survive untouched.
        expect(sessionLayer.data.args).toEqual({ a: 2, b: 2 })
    })

    test('without noCache, overlays apply and write back', async () => {
        const { sessionLayer } = newScenario({
            accountArgs: { a: 1 },
            sessionArgs: { b: 2 },
        })
        const svc = new LayerTestService('u1', { args: { c: 3 } as any })
        await svc.Initialize()
        expect(sessionLayer.data.args).toMatchObject({ a: 1, b: 2, c: 3 })
    })
})

// ---------------------------------------------------------------------------
// Persistent-flag filtering — core Task 11 behavior
// ---------------------------------------------------------------------------

class PersistentArgs extends GlobalServiceArgs {
    @CmdArg({ persistent: true, description: 'persistent value' })
    kept?: string

    @CmdArg({ description: 'ephemeral value' })
    ephemeral?: string
}

class PersistentIntercom extends GlobalServiceIntercom {}

type PersistentData = CmdServiceData<PersistentArgs, PersistentIntercom, {}>

class PersistentTestSvc extends BaseCommandService<PersistentData> {
    constructor(userId: string, input: Partial<PersistentData> = {}) {
        super(userId, new CmdServiceData(new PersistentArgs(), new PersistentIntercom()), input, 'persistent-test-svc')
    }
    clone() { return this }
    protected async runWrapper(): Promise<void> {}
    protected async terminateWrapper(): Promise<void> {}
    async receiveMsg(): Promise<void> {}
}

describe('initSession persistent-flag filtering', () => {
    test('only persistent leaves are written to the session layer', async () => {
        const { sessionLayer } = newScenario()
        const svc = new PersistentTestSvc('user-1', {
            args: { kept: 'k1', ephemeral: 'e1' } as Partial<PersistentArgs>,
        } as Partial<PersistentData>)

        await svc.Initialize()

        const layerArgs = sessionLayer.data.args as Record<string, unknown> | undefined
        expect(layerArgs).toBeDefined()
        expect(layerArgs!.kept).toBe('k1')
        expect(layerArgs!.ephemeral).toBeUndefined()
    })

    test('ephemeral leaves are read from input, not the layered store', async () => {
        // pre-seed both keys in the session layer; ephemeral should not be picked up
        newScenario({ sessionArgs: { kept: 'session-k', ephemeral: 'session-e' } })
        const svc = new PersistentTestSvc('user-1', {
            args: { ephemeral: 'input-e' } as Partial<PersistentArgs>,
        } as Partial<PersistentData>)

        await svc.Initialize()

        // Persistent: layered merge picks up the session value.
        expect((svc as any).data.args.kept).toBe('session-k')
        // Ephemeral: from input only; the session-layer value is ignored.
        expect((svc as any).data.args.ephemeral).toBe('input-e')
    })

    test('ephemeral leaves do not leak into this.data.args after Initialize when not provided', async () => {
        // No input at all → ephemeral leaf stays undefined; persistent leaf comes from session layer.
        const { sessionLayer } = newScenario({ sessionArgs: { kept: 'session-k', ephemeral: 'leak-attempt' } })
        const svc = new PersistentTestSvc('user-1', {} as Partial<PersistentData>)

        await svc.Initialize()

        expect((svc as any).data.args.kept).toBe('session-k')
        // The session layer's stale 'leak-attempt' should NOT enter this.data.args.
        expect((svc as any).data.args.ephemeral).toBeUndefined()

        // Also verify the session layer was NOT updated with ephemeral data.
        expect((sessionLayer.data.args as any)?.ephemeral).toBeUndefined()
    })
})
