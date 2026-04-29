import { AIAgentSource } from '../index'
import type { ServiceContext } from '../../../exporters/types'

/** AIAgentSource.availability() is required to be context-free per the
 *  IScraperSource contract — the registry caches the result for 60s by
 *  source name only, and would otherwise misroute one user's "ok" or
 *  "not ok" to another user's request (or to a delegate-source enum
 *  rebuild after the cache TTL elapses mid-run). The real config check
 *  lives in `search()` and is per-invocation. */
describe('AIAgentSource.availability — context-free contract', () => {
    it('returns ok=true with no context', async () => {
        const src = new AIAgentSource()
        const r = await src.availability()
        expect(r.ok).toBe(true)
    })

    it('returns ok=true with context that has no aiAgent config', async () => {
        const src = new AIAgentSource()
        const ctx = { args: {} } as unknown as ServiceContext
        const r = await src.availability(ctx)
        expect(r.ok).toBe(true)
    })

    it('returns ok=true with context that has full aiAgent config', async () => {
        const src = new AIAgentSource()
        const ctx = {
            args: {
                aiAgent: {
                    baseUrl: 'http://127.0.0.1:11434/v1',
                    model: 'qwen3.5:9b',
                },
            },
        } as unknown as ServiceContext
        const r = await src.availability(ctx)
        expect(r.ok).toBe(true)
    })

    it('search() throws a helpful error when baseUrl/model is missing', async () => {
        const src = new AIAgentSource()
        const gen = src.search(
            { query: 'test', city: 'Москва', sources: ['ai-agent'], maxResults: 10 },
            () => {},
            { args: {} } as unknown as ServiceContext,
        )
        await expect(gen.next()).rejects.toThrow(/baseUrl.*model.*empty/i)
    })
})
