import { z } from 'zod'
import { Application } from '../application'
import { defineCapability } from '../capability'
import {
    CapabilityValidationError,
    type CommandRegistration,
} from '../manifest'

const CAP_FOO = defineCapability<string>('test.foo')
const CAP_BAR = defineCapability<number>('test.bar')

class TestApp extends Application<Record<string, unknown>> {
    public registered: CommandRegistration[] = []
    async run(): Promise<void> {}
    protected _collectRegisteredCommands(): CommandRegistration[] {
        return this.registered
    }
}

function makeApp(name: string): TestApp {
    return new TestApp({
        configPath: '',
        baseSchema: z.object({}),
        inlineConfig: {},
        name,
    })
}

describe('boot-time capability validation', () => {
    it('passes when every required capability is provided', async () => {
        const app = makeApp('cap-validate-pass')
        app.registered = [
            { name: 'svc-a', requires: [CAP_FOO] },
            { name: 'svc-b', requires: [CAP_FOO, CAP_BAR] },
        ]
        app.use({
            phase: 10,
            install: (a) => {
                a.provide(CAP_FOO, 'foo-value', 'TestMiddleware')
                a.provide(CAP_BAR, 42, 'TestMiddleware')
            },
        })

        await app.Initialize()
        await app.terminate()
    })

    it('throws CapabilityValidationError when a required cap is missing', async () => {
        const app = makeApp('cap-validate-miss')
        app.registered = [
            { name: 'svc-a', requires: [CAP_FOO] },
        ]
        // No middleware provides CAP_FOO.

        let caught: unknown
        try {
            await app.Initialize()
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(CapabilityValidationError)
        const err = caught as CapabilityValidationError
        expect(err.failures).toHaveLength(1)
        expect(err.failures[0].commandName).toBe('svc-a')
        expect(err.failures[0].missing).toEqual([CAP_FOO])
        expect(err.message).toContain('svc-a')
        expect(err.message).toContain(CAP_FOO)
    })

    it('aggregates missing caps across every registered command', async () => {
        const app = makeApp('cap-validate-multi')
        app.registered = [
            { name: 'svc-a', requires: [CAP_FOO] },
            { name: 'svc-b', requires: [CAP_FOO, CAP_BAR] },
            { name: 'svc-c', requires: [CAP_BAR] },
        ]
        app.use({
            phase: 10,
            install: (a) => { a.provide(CAP_FOO, 'foo-value') },
        })

        let caught: unknown
        try {
            await app.Initialize()
        } catch (e) {
            caught = e
        }
        const err = caught as CapabilityValidationError
        expect(err.failures.map(f => f.commandName).sort()).toEqual(['svc-b', 'svc-c'])
        const svcB = err.failures.find(f => f.commandName === 'svc-b')!
        expect(svcB.missing).toEqual([CAP_BAR])
        const svcC = err.failures.find(f => f.commandName === 'svc-c')!
        expect(svcC.missing).toEqual([CAP_BAR])
    })

    it('surfaces published capabilities in manifestSnapshot', async () => {
        const app = makeApp('cap-validate-snap')
        app.use({
            phase: 10,
            install: (a) => {
                a.provide(CAP_FOO, 'foo-value', 'FooMiddleware')
                a.provide(CAP_BAR, 7, 'BarMiddleware')
            },
        })
        app.registered = [{ name: 'svc-a', requires: [CAP_FOO] }]
        await app.Initialize()

        const snap = app.manifestSnapshot()
        const fooCap = snap.capabilities.find(c => c.key === CAP_FOO)
        expect(fooCap).toBeDefined()
        expect(fooCap!.providedBy).toBe('FooMiddleware')
        expect(snap.commands).toHaveLength(1)
        expect(snap.commands[0]).toEqual({ name: 'svc-a', requires: [CAP_FOO] })

        await app.terminate()
    })

    it('releases the lock when validation fails so subsequent retries succeed', async () => {
        const app1 = makeApp('cap-validate-lock')
        app1.registered = [{ name: 'svc-a', requires: [CAP_FOO] }]
        await expect(app1.Initialize()).rejects.toBeInstanceOf(CapabilityValidationError)

        // The lock from the first failed Initialize should have been released.
        // A fresh app with the same id + a satisfying middleware must succeed.
        const app2 = makeApp('cap-validate-lock')
        app2.registered = [{ name: 'svc-a', requires: [CAP_FOO] }]
        app2.use({
            phase: 10,
            install: (a) => { a.provide(CAP_FOO, 'foo-value') },
        })
        await app2.Initialize()
        await app2.terminate()
    })
})
