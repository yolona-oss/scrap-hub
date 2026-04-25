import 'reflect-metadata'
import { z } from 'zod'
import {
    defineCapability,
    CapabilityValidationError,
    CAP_ManagerRepo,
    CAP_AccountRepo,
    CAP_InvitationLinkRepo,
    CAP_CmdAliasRepo,
    CAP_PendingDeleteRepo,
} from '@cmd-hub/common'
import type {
    ConfigContributor,
    IUI,
    AppLike,
    ICapabilityRegistry,
} from '@cmd-hub/common'
import { CmdHubApp } from '../cmd-hub-app'
import type { DispatcherRepos } from '../../ui/command-processor/dispatcher'

const CAP_FAKE = defineCapability<string>('test.cmdHubFake')

/** Minimal in-process dispatcher stub that the hub-side validator can walk.
 *  Records its `requires[]` and exposes `collectRegisteredCommands` for
 *  CmdHubApp.run() to validate against the live caps. */
class StubDispatcher {
    constructor(private readonly cmds: { name: string; requires: string[] }[]) {}
    attachManifestAggregator(_a: unknown): void {}
    attachRemoteInvoker(_c: unknown): void {}
    attachNodeClient(_c: unknown): void {}
    attachRepos(_r: DispatcherRepos): void {}
    collectRegisteredCommands(): { name: string; requires: readonly string[] }[] {
        return this.cmds.map(c => ({ name: c.name, requires: c.requires }))
    }
}

class StubUI implements IUI<any>, ConfigContributor {
    readonly dispatcher: StubDispatcher
    readonly namespace = 'stubui'
    readonly schema = z.object({})
    private running = false

    constructor(commands: { name: string; requires: string[] }[]) {
        this.dispatcher = new StubDispatcher(commands)
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

/** Provide every storage cap the hub's run-time prelude requires. Call
 *  patterns that pre-empt the validator (e.g. missing `CAP_ManagerRepo`)
 *  also show up at run() time, but Phase B's specific failure mode is
 *  the per-command validator — that's what these tests exercise. */
function provideStorageCaps(reg: ICapabilityRegistry): void {
    reg.provide(CAP_ManagerRepo, {} as never)
    reg.provide(CAP_AccountRepo, {} as never)
    reg.provide(CAP_InvitationLinkRepo, {} as never)
    reg.provide(CAP_CmdAliasRepo, {} as never)
    reg.provide(CAP_PendingDeleteRepo, {} as never)
}

describe('CmdHubApp run-time capability validator', () => {
    function mkApp(name: string, ui: StubUI): CmdHubApp {
        const app = new CmdHubApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: { stubui: {} },
            name,
        }).useUI(ui)
        return app
    }

    it('passes run() when every command\'s requires are satisfied by published caps', async () => {
        const ui = new StubUI([
            { name: 'foo', requires: [CAP_FAKE] },
        ])
        const app = mkApp(`hub-validate-pass-${Math.random().toString(36).slice(2)}`, ui)
        app.use({
            phase: 10,
            install: (a) => {
                provideStorageCaps(a)
                a.provide(CAP_FAKE, 'value', 'TestMiddleware')
            },
        })

        await app.Initialize()
        await app.run()
        expect(ui.isRunning()).toBe(true)
        await app.terminate()
    })

    it('throws CapabilityValidationError on run() when a registered command requires a missing cap', async () => {
        const ui = new StubUI([
            { name: 'foo', requires: [CAP_FAKE] },
        ])
        const app = mkApp(`hub-validate-fail-${Math.random().toString(36).slice(2)}`, ui)
        app.use({
            phase: 10,
            install: (a) => {
                provideStorageCaps(a)
                // CAP_FAKE intentionally NOT provided
            },
        })

        await app.Initialize()
        let caught: unknown
        try {
            await app.run()
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(CapabilityValidationError)
        const err = caught as CapabilityValidationError
        expect(err.failures).toHaveLength(1)
        expect(err.failures[0].commandName).toBe('foo')
        expect(err.failures[0].missing).toEqual([CAP_FAKE])
        expect(ui.isRunning()).toBe(false)
        await app.terminate()
    })

    it('aggregates failures across multiple commands', async () => {
        const ui = new StubUI([
            { name: 'cmd-a', requires: [CAP_FAKE] },
            { name: 'cmd-b', requires: [CAP_FAKE, CAP_ManagerRepo] },
            { name: 'cmd-c', requires: [] },
        ])
        const app = mkApp(`hub-validate-multi-${Math.random().toString(36).slice(2)}`, ui)
        app.use({
            phase: 10,
            install: (a) => {
                provideStorageCaps(a)
                // CAP_FAKE missing — cmd-a + cmd-b both fail
            },
        })

        await app.Initialize()
        let caught: unknown
        try {
            await app.run()
        } catch (e) {
            caught = e
        }
        const err = caught as CapabilityValidationError
        expect(err.failures.map(f => f.commandName).sort()).toEqual(['cmd-a', 'cmd-b'])
        await app.terminate()
    })
})
