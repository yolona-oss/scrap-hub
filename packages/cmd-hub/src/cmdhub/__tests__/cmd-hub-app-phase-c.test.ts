import 'reflect-metadata'
import { z } from 'zod'
import {
    type ConfigContributor,
    type IUI,
    type AppLike,
    type ICapabilityRegistry,
    defineCapability,
} from '@cmd-hub/common'
import {
    ManifestAggregator,
    type AggregatedManifest,
} from '@cmd-hub/transport'
import { CAP_ManifestAggregator } from '@cmd-hub/transport'
import { CmdHubApp, type UIFederationRequires } from '../cmd-hub-app'

const CAP_DB = defineCapability<string>('phase-c-hub.db')
const CAP_ANALYTICS = defineCapability<string>('phase-c-hub.analytics')

class StubUI implements IUI<any>, ConfigContributor {
    readonly dispatcher: unknown = null
    readonly namespace: string
    readonly schema = z.object({})
    public readonly federationRequires?: UIFederationRequires
    private running = false

    constructor(
        private readonly ctxName: string,
        federationRequires?: UIFederationRequires,
    ) {
        this.namespace = ctxName
        this.federationRequires = federationRequires
    }
    async onAppAttach(_app: AppLike): Promise<void> {}
    async run(): Promise<void> { this.running = true }
    async terminate(): Promise<void> { this.running = false }
    isRunning(): boolean { return this.running }
    isInitialized(): boolean { return true }
    async sendMessage(): Promise<string> { return 'm-1' }
    async editMessage(): Promise<void> {}
    async deleteMessage(): Promise<void> {}
    max_message_width(): number { return 60 }
    ContextType(): string { return this.ctxName }
    consolePrintCommands(): void {}
    lock(): boolean { return true }
    unlock(): boolean { return true }
}

function makeManifest(opts: {
    nodeId: string
    publishedCapabilities?: string[]
    cmd?: { name: string; compatibilityId: string; requires?: string[] }
}): AggregatedManifest {
    const cmd = opts.cmd ?? { name: 'work', compatibilityId: 'com.example.work', requires: [] }
    return {
        nodeId: opts.nodeId,
        nodeName: opts.nodeId,
        version: '1.0.0',
        commands: [{
            name: cmd.name,
            compatibilityId: cmd.compatibilityId,
            version: '1.0.0',
            description: '',
            args: [],
            aliases: [],
            requires: cmd.requires ?? [],
        }],
        services: [],
        configs: [],
        hardware: {},
        metrics: {},
        publishedCapabilities: opts.publishedCapabilities ?? [],
    }
}

/** Provide every storage cap CmdHubApp.run requires; the Phase C concern
 *  here is the aggregator wiring, not the validator from earlier phases. */
function provideStorageCaps(reg: ICapabilityRegistry): void {
    const noop = {} as never
    reg.provide(defineCapability<unknown>('common.managerRepo'), noop)
    reg.provide(defineCapability<unknown>('common.accountRepo'), noop)
    reg.provide(defineCapability<unknown>('common.invitationLinkRepo'), noop)
    reg.provide(defineCapability<unknown>('common.cmdAliasRepo'), noop)
    reg.provide(defineCapability<unknown>('common.pendingDeleteRepo'), noop)
}

describe('CmdHubApp Phase C: UI federationRequires drives aggregator filtering', () => {
    function mkApp(name: string, uis: StubUI[]) {
        const inlineConfig: Record<string, unknown> = {}
        for (const ui of uis) inlineConfig[ui.ContextType()] = {}
        const app = new CmdHubApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig,
            name,
        })
        for (const ui of uis) app.useUI(ui)
        return app
    }

    it('UIs with no federationRequires set no UI requirements on the aggregator', async () => {
        const ui = new StubUI('plain')
        const app = mkApp(`phaseC-noreqs-${Math.random().toString(36).slice(2)}`, [ui])
        const aggregator = new ManifestAggregator()
        app.use({
            phase: 10,
            install: (a) => {
                provideStorageCaps(a)
                a.provide(CAP_ManifestAggregator, aggregator)
            },
        })
        await app.Initialize()
        await app.run()

        // Aggregator should accept any node without UI filtering.
        const r = aggregator.attach(makeManifest({
            nodeId: 'A',
            publishedCapabilities: [],  // no caps published — but UI doesn't care
        }))
        expect(r.ok).toBe(true)
        if (!r.ok) throw new Error('expected ok')
        expect(r.warnings).toHaveLength(0)
        // Pool member has no UI eligibility set → eligible for everyone.
        expect(aggregator.getPool().pick('work', { uiName: 'plain' })?.nodeId).toBe('A')

        await app.terminate()
    })

    it('UIs with federationRequires.essential cause incompatible nodes to be dropped per-UI', async () => {
        const tg = new StubUI('telegram', { essential: [CAP_DB] })
        const cli = new StubUI('cli')  // no federationRequires
        const app = mkApp(`phaseC-essential-${Math.random().toString(36).slice(2)}`, [tg, cli])
        const aggregator = new ManifestAggregator()
        app.use({
            phase: 10,
            install: (a) => {
                provideStorageCaps(a)
                a.provide(CAP_ManifestAggregator, aggregator)
            },
        })
        await app.Initialize()
        await app.run()

        const r = aggregator.attach(makeManifest({
            nodeId: 'A',
            publishedCapabilities: [],  // no CAP_DB
        }))
        expect(r.ok).toBe(true)
        if (!r.ok) throw new Error('expected ok')

        // The aggregator emits a 'rejected' warning for telegram. cli has
        // no requirements registered → the aggregator only knows about
        // telegram, so 'cli' isn't an eligibleUI. Both are unrouteable
        // for it because per-UI filtering only allows UIs the aggregator
        // knows about.
        expect(r.warnings.length).toBeGreaterThan(0)
        const tgWarnings = r.warnings.filter(w => w.uiName === 'telegram')
        expect(tgWarnings).toHaveLength(1)
        expect(tgWarnings[0].severity).toBe('rejected')
        expect(tgWarnings[0].missingCaps).toEqual([CAP_DB])

        // Node A is not eligible for telegram routing.
        expect(aggregator.getPool().pick('work', { uiName: 'telegram' })).toBeNull()

        await app.terminate()
    })

    it('supported caps emit warnings but keep routing eligibility', async () => {
        const tg = new StubUI('telegram', { essential: [CAP_DB], supported: [CAP_ANALYTICS] })
        const app = mkApp(`phaseC-supported-${Math.random().toString(36).slice(2)}`, [tg])
        const aggregator = new ManifestAggregator()
        app.use({
            phase: 10,
            install: (a) => {
                provideStorageCaps(a)
                a.provide(CAP_ManifestAggregator, aggregator)
            },
        })
        await app.Initialize()
        await app.run()

        const r = aggregator.attach(makeManifest({
            nodeId: 'A',
            publishedCapabilities: [CAP_DB],  // essential met, supported missing
        }))
        if (!r.ok) throw new Error('expected ok')
        expect(r.warnings).toHaveLength(1)
        expect(r.warnings[0].severity).toBe('warned')
        expect(r.warnings[0].missingCaps).toEqual([CAP_ANALYTICS])

        // Still eligible despite the warning.
        expect(aggregator.getPool().pick('work', { uiName: 'telegram' })?.nodeId).toBe('A')

        await app.terminate()
    })
})
