import 'reflect-metadata'

import { BaseCommandService } from '../base-command-service'
import { CmdServiceData, GlobalServiceConfig, GlobalServiceParam, GlobalServiceMessages } from '../service-data'
import {
    IServiceStore,
    IServiceAccountLayer,
    IServiceSessionLayer,
    IServiceStoreLoadResult,
    DEFAULT_ACCOUNT_SESSION_NAME,
} from '../service-store'
import { assignToCustomPath } from '../../utils/object'

class FakeAccountLayer implements IServiceAccountLayer {
    public data: Record<string, unknown> = {}
    public writes: Array<{ path: string; value: unknown }> = []

    async setField(path: string, value: unknown): Promise<void> {
        this.writes.push({ path, value })
        assignToCustomPath(this.data, path, value)
    }

    async replaceConfig(config: Record<string, unknown>): Promise<void> {
        this.data.config = config
    }
}

class FakeSessionLayer implements IServiceSessionLayer {
    public data: Record<string, unknown> = {}
    public writes: Array<{ path: string; value: unknown }> = []

    constructor(public readonly name: string) {}

    async setField(path: string, value: unknown): Promise<void> {
        this.writes.push({ path, value })
        assignToCustomPath(this.data, path, value)
    }

    async replaceData(data: Record<string, unknown>): Promise<void> {
        this.data = data
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

class TestServiceData extends CmdServiceData<GlobalServiceConfig, GlobalServiceParam, GlobalServiceMessages, {}> {
    constructor() {
        super(new GlobalServiceConfig(), new GlobalServiceParam(), new GlobalServiceMessages())
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
    public async testSetConfig(path: string, value: unknown) { return this.setConfigValue(path, value) }
    public async testSetRuntimeState(path: string, value: unknown) { return this.setRuntimeStateValue(path, value) }
}

function newScenario(opts: {
    accountConfig?: Record<string, unknown>
    sessionConfig?: Record<string, unknown>
    sessionRuntimeState?: Record<string, unknown>
    sessionName?: string
} = {}) {
    const accountLayer = new FakeAccountLayer()
    if (opts.accountConfig) accountLayer.data = { config: opts.accountConfig }
    const sessionLayer = new FakeSessionLayer(opts.sessionName ?? DEFAULT_ACCOUNT_SESSION_NAME)
    sessionLayer.data = {}
    if (opts.sessionConfig) sessionLayer.data.config = opts.sessionConfig
    if (opts.sessionRuntimeState) sessionLayer.data.runtimeState = opts.sessionRuntimeState
    const store = new FakeStore(accountLayer, sessionLayer)
    BaseCommandService.setStore(store)
    return { store, accountLayer, sessionLayer }
}

beforeEach(() => {
    BaseCommandService.__resetStoreForTests()
})

describe('BaseCommandService — layered config precedence', () => {
    test('session overlay overrides account baseline; input overrides session', async () => {
        const { sessionLayer } = newScenario({
            accountConfig: { a: 1, b: 1, c: 1 },
            sessionConfig: { b: 2, c: 2 },
        })
        const svc = new TestService('u1', { config: { c: 3 } as any })
        await svc.Initialize()
        // a only in account → 1; b in account+session → session wins → 2; c in all three → input wins → 3
        const cfg = (svc.snapshot as any).config
        expect(cfg.a).toBe(1)
        expect(cfg.b).toBe(2)
        expect(cfg.c).toBe(3)
        // The merged result was written back to session layer.
        expect(sessionLayer.data.config).toMatchObject({ a: 1, b: 2, c: 3 })
    })

    test('legacy account-only data still merges through (no session overlay yet)', async () => {
        const { sessionLayer } = newScenario({ accountConfig: { a: 1, b: 1 } })
        const svc = new TestService('u1')
        await svc.Initialize()
        const cfg = (svc.snapshot as any).config
        expect(cfg).toMatchObject({ a: 1, b: 1 })
        // The merge result was persisted as a session overlay.
        expect(sessionLayer.data.config).toMatchObject({ a: 1, b: 1 })
    })
})

describe('BaseCommandService — setConfigValue routes to session layer', () => {
    test('setConfigValue writes to session layer, not account', async () => {
        const { accountLayer, sessionLayer } = newScenario({
            accountConfig: { existing: 'baseline' },
        })
        const svc = new TestService('u1')
        await svc.Initialize()
        accountLayer.writes.length = 0  // clear init writes
        sessionLayer.writes.length = 0

        await svc.testSetConfig('newKey', 'newVal')
        expect(sessionLayer.writes).toEqual([{ path: 'config.newKey', value: 'newVal' }])
        expect(accountLayer.writes).toEqual([])
        expect(accountLayer.data.config).toEqual({ existing: 'baseline' })
    })

    test('setRuntimeStateValue writes to session layer under runtimeState key', async () => {
        const { sessionLayer } = newScenario()
        const svc = new TestService('u1')
        await svc.Initialize()
        sessionLayer.writes.length = 0

        await svc.testSetRuntimeState('progress', 42)
        expect(sessionLayer.writes).toEqual([{ path: 'runtimeState.progress', value: 42 }])
    })
})

describe('BaseCommandService — noCache bypass', () => {
    test('noCache=true skips overlay reads AND skips session-layer write', async () => {
        const { sessionLayer } = newScenario({
            accountConfig: { a: 1 },
            sessionConfig: { a: 2, b: 2 },
        })
        const svc = new TestService('u1', {
            config: { c: 3 } as any,
            params: { noCache: true } as any,
        })
        await svc.Initialize()
        const cfg = (svc.snapshot as any).config
        // Saved values were skipped; only defaults + input apply.
        expect(cfg.a).toBeUndefined()
        expect(cfg.b).toBeUndefined()
        expect(cfg.c).toBe(3)
        // Session overlay was NOT written — saved values survive untouched.
        expect(sessionLayer.data.config).toEqual({ a: 2, b: 2 })
    })

    test('without noCache, overlays apply and write back', async () => {
        const { sessionLayer } = newScenario({
            accountConfig: { a: 1 },
            sessionConfig: { b: 2 },
        })
        const svc = new TestService('u1', { config: { c: 3 } as any })
        await svc.Initialize()
        expect(sessionLayer.data.config).toMatchObject({ a: 1, b: 2, c: 3 })
    })
})
