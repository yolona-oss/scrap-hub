import { Application } from '../application'
import { Phase } from '../phase'
import { ConfigContributor, IAppMiddleware } from '../middleware-types'
import { z } from 'zod'

class TestApp extends Application<{ base: number; added?: { n: string }; tls?: { caCertPath: string; serverCertPath: string }; shared?: { x: string } }> {
    async run(): Promise<void> {}
}

const mwContributor: IAppMiddleware & ConfigContributor = {
    phase: Phase.Storage,
    namespace: 'added',
    schema: z.object({ n: z.string() }),
    install: () => undefined,
}

describe('Config contributor discovery', () => {
    it('merges middleware contributor schemas with baseSchema', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({ base: z.number() }),
            inlineConfig: { base: 1, added: { n: 'hello' } },
        }).use(mwContributor)

        await app.Initialize()
        expect(app.config.added?.n).toBe('hello')
        await app.terminate()
    })

    it('throws on namespace collision with overlapping keys', async () => {
        const a: IAppMiddleware & ConfigContributor = {
            phase: Phase.Storage, namespace: 'shared', install: () => undefined,
            schema: z.object({ x: z.string() }),
        }
        const b: IAppMiddleware & ConfigContributor = {
            phase: Phase.Storage, namespace: 'shared', install: () => undefined,
            schema: z.object({ x: z.string() }),  // same key
        }
        const app = new TestApp({
            configPath: '', baseSchema: z.object({ base: z.number() }),
            inlineConfig: { base: 1, shared: { x: '1' } },
        }).use(a).use(b)
        await expect(app.Initialize()).rejects.toThrow(/shared/)
    })

    it('merges disjoint slices in the same namespace', async () => {
        const a: IAppMiddleware & ConfigContributor = {
            phase: Phase.Storage, namespace: 'tls', install: () => undefined,
            schema: z.object({ caCertPath: z.string() }),
        }
        const b: IAppMiddleware & ConfigContributor = {
            phase: Phase.Storage, namespace: 'tls', install: () => undefined,
            schema: z.object({ serverCertPath: z.string() }),
        }
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({ base: z.number() }),
            inlineConfig: {
                base: 1,
                tls: { caCertPath: '/ca.crt', serverCertPath: '/hub.crt' },
            },
        })
        app.use(a); app.use(b)
        await app.Initialize()
        expect(app.config.tls?.caCertPath).toBe('/ca.crt')
        expect(app.config.tls?.serverCertPath).toBe('/hub.crt')
        await app.terminate()
    })
})
