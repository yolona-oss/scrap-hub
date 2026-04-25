import 'reflect-metadata'
import { z } from 'zod'
import { Application, Phase, defineCapability } from '@cmd-hub/common'
import { FederationCapsMiddleware } from '../federation-caps-middleware'
import { CAP_FederationRequires } from '../../capabilities'

const CAP_FAKE_A = defineCapability<string>('test.fakeA')
const CAP_FAKE_B = defineCapability<number>('test.fakeB')
const CAP_FAKE_C = defineCapability<boolean>('test.fakeC')
const CAP_MISSING = defineCapability<string>('test.missing')

class TestApp extends Application<any> {
    async run(): Promise<void> {}
}

function makeApp(name: string): TestApp {
    return new TestApp({
        configPath: '',
        baseSchema: z.object({}),
        inlineConfig: {},
        name,
    })
}

/** Phase.Infrastructure middleware that pre-publishes faked caps so the
 *  FederationCapsMiddleware (Phase.BeforeServices) sees them at install. */
function provideFakeCaps(...keys: { key: ReturnType<typeof defineCapability>; value: unknown }[]) {
    return {
        phase: Phase.Infrastructure,
        install: (app: any) => {
            for (const { key, value } of keys) {
                app.provide(key, value)
            }
        },
    }
}

describe('FederationCapsMiddleware', () => {
    it('publishes CAP_FederationRequires with essential + auto-filled supported', async () => {
        const app = makeApp(`fed-caps-pass-${Math.random().toString(36).slice(2)}`)
        app.use(provideFakeCaps(
            { key: CAP_FAKE_A, value: 'a' },
            { key: CAP_FAKE_B, value: 42 },
            { key: CAP_FAKE_C, value: true },
        ))
        app.use(new FederationCapsMiddleware({ essential: [CAP_FAKE_A] }))

        await app.Initialize()
        const payload = app.get(CAP_FederationRequires)
        expect(payload).toBeDefined()
        expect(payload!.essential.map(k => k as string)).toEqual([CAP_FAKE_A as string])
        const supportedKeys = payload!.supported.map(k => k as string)
        expect(supportedKeys).toContain(CAP_FAKE_B as string)
        expect(supportedKeys).toContain(CAP_FAKE_C as string)
        expect(supportedKeys).not.toContain(CAP_FAKE_A as string)

        await app.terminate()
    })

    it('honours an explicit supported override', async () => {
        const app = makeApp(`fed-caps-explicit-${Math.random().toString(36).slice(2)}`)
        app.use(provideFakeCaps(
            { key: CAP_FAKE_A, value: 'a' },
            { key: CAP_FAKE_B, value: 42 },
            { key: CAP_FAKE_C, value: true },
        ))
        app.use(new FederationCapsMiddleware({
            essential: [CAP_FAKE_A],
            supported: [CAP_FAKE_C],  // explicit override; CAP_FAKE_B excluded
        }))

        await app.Initialize()
        const payload = app.get(CAP_FederationRequires)
        expect(payload!.supported.map(k => k as string)).toEqual([CAP_FAKE_C as string])

        await app.terminate()
    })

    it('throws when an essential cap is not registered, naming the missing key', async () => {
        const app = makeApp(`fed-caps-missing-${Math.random().toString(36).slice(2)}`)
        app.use(provideFakeCaps(
            { key: CAP_FAKE_A, value: 'a' },
        ))
        app.use(new FederationCapsMiddleware({ essential: [CAP_FAKE_A, CAP_MISSING] }))

        let caught: unknown
        try {
            await app.Initialize()
        } catch (e) {
            caught = e
        }
        expect(caught).toBeInstanceOf(Error)
        expect((caught as Error).message).toContain('FederationCapsMiddleware')
        expect((caught as Error).message).toContain(CAP_MISSING as string)
        // The successfully-registered key MUST NOT appear in the missing list.
        expect((caught as Error).message).not.toMatch(new RegExp(`"${CAP_FAKE_A as string}"`))
    })

    it('uninstall revokes CAP_FederationRequires', async () => {
        const app = makeApp(`fed-caps-uninstall-${Math.random().toString(36).slice(2)}`)
        app.use(provideFakeCaps({ key: CAP_FAKE_A, value: 'a' }))
        app.use(new FederationCapsMiddleware({ essential: [CAP_FAKE_A] }))

        await app.Initialize()
        expect(app.get(CAP_FederationRequires)).toBeDefined()

        await app.terminate()
        expect(app.get(CAP_FederationRequires)).toBeUndefined()
    })

    it('rejects construction with non-array essential', () => {
        expect(() => new FederationCapsMiddleware({ essential: undefined as never }))
            .toThrow(/essential must be an array/)
    })
})
