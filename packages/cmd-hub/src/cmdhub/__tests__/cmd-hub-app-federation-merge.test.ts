import 'reflect-metadata'
import { z } from 'zod'
import {
    defineCapability,
    Phase,
    CAP_ManagerRepo,
    CAP_AccountRepo,
    CAP_InvitationLinkRepo,
    CAP_CmdAliasRepo,
    CAP_PendingDeleteRepo,
    type ConfigContributor,
    type IUI,
    type AppLike,
    type ICapabilityRegistry,
    type CapabilityKey,
} from '@cmd-hub/common'
import { CAP_ManifestAggregator, type UIRequirementsForFiltering } from '@cmd-hub/transport'
import { CmdHubApp } from '../cmd-hub-app'
import type { UIFederationRequires } from '../cmd-hub-app'
import { FederationCapsMiddleware } from '../../middleware/federation-caps-middleware'

const CAP_APP_X = defineCapability<string>('test.appX')
const CAP_APP_Y = defineCapability<string>('test.appY')
const CAP_UI_Z = defineCapability<string>('test.uiZ')

class StubDispatcher {
    attachManifestAggregator(_a: unknown): void {}
    attachRemoteInvoker(_c: unknown): void {}
    attachNodeClient(_c: unknown): void {}
    attachRepos(_r: unknown): void {}
    collectRegisteredCommands() { return [] }
}

class StubUI implements IUI<any>, ConfigContributor {
    readonly dispatcher = new StubDispatcher()
    readonly namespace = 'stubui'
    readonly schema = z.object({})
    readonly federationRequires?: UIFederationRequires
    private running = false

    constructor(opts: { federationRequires?: UIFederationRequires } = {}) {
        this.federationRequires = opts.federationRequires
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
    ContextType(): string { return 'stub' }
    consolePrintCommands(): void {}
    lock(): boolean { return true }
    unlock(): boolean { return true }
}

/** A fake aggregator that records the latest setUIRequirements call so we
 *  can assert what CmdHubApp.run() pushed. */
class FakeAggregator {
    lastReqs: UIRequirementsForFiltering[] | null = null
    setUIRequirements(reqs: UIRequirementsForFiltering[]): void { this.lastReqs = reqs }
    onChange(_listener: () => void): () => void { return () => {} }
    attach(): unknown { return { ok: true, warnings: [] } }
    listManifests(): unknown[] { return [] }
    listCommandNames(): string[] { return [] }
    findCommand(): unknown { return undefined }
    configModuleOwners(): string[] { return [] }
}

function provideStorageCaps(reg: ICapabilityRegistry): void {
    reg.provide(CAP_ManagerRepo, {} as never)
    reg.provide(CAP_AccountRepo, {} as never)
    reg.provide(CAP_InvitationLinkRepo, {} as never)
    reg.provide(CAP_CmdAliasRepo, {} as never)
    reg.provide(CAP_PendingDeleteRepo, {} as never)
}

describe('CmdHubApp federation-requirements merge', () => {
    function mkApp(name: string, ui: StubUI, fakeAgg: FakeAggregator) {
        return new CmdHubApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: { stubui: {} },
            name,
        })
            .use({
                phase: Phase.Infrastructure,
                install: (a) => {
                    provideStorageCaps(a)
                    a.provide(CAP_APP_X, 'x')
                    a.provide(CAP_APP_Y, 'y')
                    a.provide(CAP_MANIFEST_AGG_FAKE_KEY as never, fakeAgg as never)
                },
            })
            .useUI(ui)
    }

    // The aggregator cap key the hub looks up.
    const CAP_MANIFEST_AGG_FAKE_KEY = CAP_ManifestAggregator

    it('merges app-level essentials with per-UI essentials', async () => {
        const fakeAgg = new FakeAggregator()
        const ui = new StubUI({
            federationRequires: { essential: [CAP_UI_Z as CapabilityKey<unknown>] },
        })
        const app = mkApp(`fed-merge-essentials-${Math.random().toString(36).slice(2)}`, ui, fakeAgg)
        app.use(new FederationCapsMiddleware({ essential: [CAP_APP_X] }))

        await app.Initialize()
        await app.run()

        expect(fakeAgg.lastReqs).not.toBeNull()
        expect(fakeAgg.lastReqs!.length).toBe(1)
        const req = fakeAgg.lastReqs![0]
        expect(req.uiName).toBe('stub')
        const essentials = [...req.essential].sort()
        expect(essentials).toEqual([CAP_APP_X as string, CAP_UI_Z as string].sort())

        await app.terminate()
    })

    it('app-supported is auto-filled and includes CAP_APP_Y but not CAP_APP_X (which is essential)', async () => {
        const fakeAgg = new FakeAggregator()
        const ui = new StubUI()  // no per-UI federationRequires
        const app = mkApp(`fed-merge-supported-${Math.random().toString(36).slice(2)}`, ui, fakeAgg)
        app.use(new FederationCapsMiddleware({ essential: [CAP_APP_X] }))

        await app.Initialize()
        await app.run()

        const req = fakeAgg.lastReqs![0]
        expect(req.essential).toEqual([CAP_APP_X as string])
        expect(req.supported).toContain(CAP_APP_Y as string)
        expect(req.supported).not.toContain(CAP_APP_X as string)

        await app.terminate()
    })

    it('UI essential wins over app supported (key removed from supported when also essential anywhere)', async () => {
        const fakeAgg = new FakeAggregator()
        const ui = new StubUI({
            federationRequires: { essential: [CAP_APP_Y as CapabilityKey<unknown>] },
        })
        const app = mkApp(`fed-merge-uiwins-${Math.random().toString(36).slice(2)}`, ui, fakeAgg)
        // CAP_APP_X is the app's essential; CAP_APP_Y will be auto-filled into
        // app-supported, but the UI declares it as its own essential. Result:
        // CAP_APP_Y must NOT appear in supported.
        app.use(new FederationCapsMiddleware({ essential: [CAP_APP_X] }))

        await app.Initialize()
        await app.run()

        const req = fakeAgg.lastReqs![0]
        expect(req.supported).not.toContain(CAP_APP_Y as string)
        expect([...req.essential].sort()).toEqual([CAP_APP_X as string, CAP_APP_Y as string].sort())

        await app.terminate()
    })

    it('still works without FederationCapsMiddleware (fallback to per-UI only)', async () => {
        const fakeAgg = new FakeAggregator()
        const ui = new StubUI({
            federationRequires: { essential: [CAP_UI_Z as CapabilityKey<unknown>] },
        })
        const app = mkApp(`fed-merge-no-mw-${Math.random().toString(36).slice(2)}`, ui, fakeAgg)
        // No FederationCapsMiddleware

        await app.Initialize()
        await app.run()

        const req = fakeAgg.lastReqs![0]
        expect(req.essential).toEqual([CAP_UI_Z as string])
        expect(req.supported).toEqual([])

        await app.terminate()
    })
})
