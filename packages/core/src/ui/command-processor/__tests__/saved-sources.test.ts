import 'reflect-metadata'

const mockLog = { trace: jest.fn(), debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('../../../application/logger', () => ({ __esModule: true, default: mockLog, log: mockLog }))

import { loadSavedSources, type SavedSources } from '../saved-sources'

describe('loadSavedSources', () => {
    function makeRepos(opts: {
        moduleConfig?: Record<string, unknown>
        sessions?: Array<{ name: string; createTime: number; config: Record<string, unknown> }>
        ownerExists?: boolean
        accountExists?: boolean
    }) {
        const sessions = (opts.sessions ?? []).map(s => ({
            record: { name: s.name, createTime: s.createTime, data: { config: s.config } },
        }))
        const moduleHandle = {
            record: { data: { config: opts.moduleConfig ?? {} } },
            getSessions: jest.fn().mockResolvedValue(sessions),
        }
        const account = {
            getModuleByNameOrCreate: jest.fn().mockResolvedValue({ module: moduleHandle, isNew: false }),
        }
        return {
            manager: { findByUserId: jest.fn().mockResolvedValue(opts.ownerExists === false ? null : { id: 'o1', accountId: 'a1', userId: 'u1' }) },
            account: { handleById: jest.fn().mockResolvedValue(opts.accountExists === false ? null : account) },
        }
    }

    test('returns empty map when no owner', async () => {
        const repos = makeRepos({ ownerExists: false }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.size).toBe(0)
    })

    test('returns empty map when no account', async () => {
        const repos = makeRepos({ accountExists: false }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.size).toBe(0)
    })

    test('reads module config under config/ prefix tagged module', async () => {
        const repos = makeRepos({
            moduleConfig: { city: 'Moscow', depth: 3 },
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.get('config/city')).toEqual({ value: 'Moscow', source: 'module' })
        expect(result.get('config/depth')).toEqual({ value: '3', source: 'module' })
    })

    test('most recent session config overrides module on collision; entry tagged session', async () => {
        const repos = makeRepos({
            moduleConfig: { city: 'Moscow', depth: 3 },
            sessions: [
                { name: 'older', createTime: 1000, config: { city: 'Saint-Petersburg' } },
                { name: 'newer', createTime: 2000, config: { city: 'Kazan' } },
            ],
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.get('config/city')).toEqual({ value: 'Kazan', source: 'session' })
        expect(result.get('config/depth')).toEqual({ value: '3', source: 'module' })
    })

    test('module-only key keeps module tag when session lacks it', async () => {
        const repos = makeRepos({
            moduleConfig: { depth: 3 },
            sessions: [{ name: 's', createTime: 1, config: { city: 'X' } }],
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.get('config/depth')).toEqual({ value: '3', source: 'module' })
        expect(result.get('config/city')).toEqual({ value: 'X', source: 'session' })
    })

    test('skips null/undefined/empty-string values', async () => {
        const repos = makeRepos({
            moduleConfig: { keep: 'x', dropNull: null, dropEmpty: '', dropUndef: undefined },
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.has('config/keep')).toBe(true)
        expect(result.has('config/dropNull')).toBe(false)
        expect(result.has('config/dropEmpty')).toBe(false)
        expect(result.has('config/dropUndef')).toBe(false)
    })

    test('flattens nested objects into slash-delimited paths', async () => {
        const repos = makeRepos({
            moduleConfig: { aiAgent: { model: 'gpt-4', temperature: 0.7 } },
        }) as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.get('config/aiAgent/model')).toEqual({ value: 'gpt-4', source: 'module' })
        expect(result.get('config/aiAgent/temperature')).toEqual({ value: '0.7', source: 'module' })
    })

    test('swallows DB errors and returns empty map', async () => {
        const repos = {
            manager: { findByUserId: jest.fn().mockRejectedValue(new Error('db down')) },
            account: { handleById: jest.fn() },
        } as any
        const result = await loadSavedSources(repos, 'u1', 'scraper')
        expect(result.size).toBe(0)
    })
})
