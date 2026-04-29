import axios from 'axios'

jest.mock('axios')
jest.mock('../../scraper-service/system-config', () => {
    const actual = jest.requireActual('../../scraper-service/system-config')
    return {
        ...actual,
        DEFAULT_USER_AGENT: 'test-ua',
        SCRAPER_ACCEPT_LANGUAGE: 'ru-RU,ru;q=0.9',
        getScraperSystemConfig: jest.fn(async () => ({
            chromePath: '',
            requestDelayMs: 0,
            userAgent: 'test-ua',
        })),
    }
})

import { YandexBusinessSource, _resetYandexBusinessSession } from '../yandex-business'
import { clearHttpConfigMemo } from '../http'
import type { OrgData, SearchQuery } from '../../types'

const mockedAxios = axios as jest.Mocked<typeof axios>

beforeEach(() => {
    jest.clearAllMocks()
    clearHttpConfigMemo()
    _resetYandexBusinessSession()
    ;(mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
        (e: unknown) => Boolean(e && typeof e === 'object' && (e as any).isAxiosError === true),
    )
})

const makeQuery = (over: Partial<SearchQuery> = {}): SearchQuery => ({
    query: 'Адвокат',
    city: 'Санкт-Петербург',
    sources: ['yandex-business'],
    maxResults: 10,
    ...over,
})

const tokenOnlyResponse = (over: Record<string, any> = {}) => ({
    status: 200,
    data: { csrfToken: 'tok123', sessionId: 'sess456', ...over },
    headers: { 'set-cookie': ['yandexuid=12345; Path=/; Domain=.yandex.ru', '_yasc=ZZZ; Path=/'] },
})

const featuresResponse = (count: number) => ({
    status: 200,
    data: {
        features: Array.from({ length: count }, (_, i) => ({
            properties: {
                CompanyMetaData: {
                    name: `Org ${i}`,
                    Phones: [{ formatted: `+7 (812) 000-00-${String(i).padStart(2, '0')}` }],
                    Address: { formatted: `г. Санкт-Петербург, ул. Тестовая, ${i}` },
                },
            },
        })),
    },
    headers: {},
})

async function collect(source: YandexBusinessSource, query: SearchQuery): Promise<OrgData[]> {
    const out: OrgData[] = []
    for await (const o of source.search(query, () => { /* noop */ })) out.push(o)
    return out
}

describe('YandexBusinessSource — CSRF flow', () => {
    it('two-step: acquires CSRF on first call, then yields features', async () => {
        mockedAxios.request
            .mockResolvedValueOnce(tokenOnlyResponse() as any)         // step 1: probe
            .mockResolvedValueOnce(featuresResponse(2) as any)          // step 2: real search

        const source = new YandexBusinessSource()
        const orgs = await collect(source, makeQuery({ maxResults: 10 }))

        expect(orgs).toHaveLength(2)
        expect(orgs[0].name).toBe('Org 0')
        expect(mockedAxios.request).toHaveBeenCalledTimes(2)

        // Step 2 URL must carry the captured token + sessionId
        const step2 = mockedAxios.request.mock.calls[1][0]!
        expect(step2.url).toContain('csrfToken=tok123')
        expect(step2.url).toContain('sessionId=sess456')
        // URLSearchParams encodes spaces as `+`, not `%20`.
        expect(step2.url).toContain('text=' + encodeURIComponent('Адвокат').replace(/%20/g, '+'))
        expect(step2.url).toContain(encodeURIComponent('Санкт-Петербург'))

        // Step 2 must replay cookies captured from step 1
        const cookieHeader = (step2.headers as any).Cookie
        expect(cookieHeader).toContain('yandexuid=12345')
        expect(cookieHeader).toContain('_yasc=ZZZ')
    })

    it('caches the token across subsequent searches', async () => {
        mockedAxios.request
            .mockResolvedValueOnce(tokenOnlyResponse() as any)         // step 1: probe (one-time)
            .mockResolvedValueOnce(featuresResponse(1) as any)          // search A
            .mockResolvedValueOnce(featuresResponse(1) as any)          // search B reuses token

        const source = new YandexBusinessSource()
        await collect(source, makeQuery({ query: 'A' }))
        await collect(source, makeQuery({ query: 'B' }))

        expect(mockedAxios.request).toHaveBeenCalledTimes(3)
        // Both data-fetching calls (#2 and #3) reused the same token
        expect((mockedAxios.request.mock.calls[1][0] as any).url).toContain('csrfToken=tok123')
        expect((mockedAxios.request.mock.calls[2][0] as any).url).toContain('csrfToken=tok123')
    })

    it('invalidates cache and retries once when step-2 returns another token', async () => {
        mockedAxios.request
            .mockResolvedValueOnce(tokenOnlyResponse({ csrfToken: 'old' }) as any) // step 1
            .mockResolvedValueOnce(tokenOnlyResponse({ csrfToken: 'old' }) as any) // step 2 stale (server re-challenges)
            .mockResolvedValueOnce(tokenOnlyResponse({ csrfToken: 'fresh' }) as any) // step 1 retry
            .mockResolvedValueOnce(featuresResponse(1) as any)                       // step 2 retry — accepts

        const source = new YandexBusinessSource()
        const orgs = await collect(source, makeQuery())

        expect(orgs).toHaveLength(1)
        expect(mockedAxios.request).toHaveBeenCalledTimes(4)
        expect((mockedAxios.request.mock.calls[3][0] as any).url).toContain('csrfToken=fresh')
    })

    it('returns no results when the token keeps being rejected', async () => {
        // Both attempts get a token-only response on step 2 — give up.
        mockedAxios.request
            .mockResolvedValueOnce(tokenOnlyResponse() as any)
            .mockResolvedValueOnce(tokenOnlyResponse() as any)
            .mockResolvedValueOnce(tokenOnlyResponse() as any)
            .mockResolvedValueOnce(tokenOnlyResponse() as any)

        const source = new YandexBusinessSource()
        const orgs = await collect(source, makeQuery())

        expect(orgs).toHaveLength(0)
        // Should NOT keep retrying past the second attempt — bounded.
        expect(mockedAxios.request.mock.calls.length).toBeLessThanOrEqual(4)
    })

    it('returns no results when CSRF acquire fails (HTTP 4xx)', async () => {
        mockedAxios.request.mockResolvedValueOnce({ status: 403, data: '', headers: {} } as any)

        const source = new YandexBusinessSource()
        const orgs = await collect(source, makeQuery())

        expect(orgs).toHaveLength(0)
        // Acquire failed → no step-2 attempt
        expect(mockedAxios.request).toHaveBeenCalledTimes(1)
    })

    it('handles step-2 HTTP 4xx by giving up cleanly', async () => {
        mockedAxios.request
            .mockResolvedValueOnce(tokenOnlyResponse() as any)
            .mockResolvedValueOnce({ status: 500, data: '', headers: {} } as any)

        const source = new YandexBusinessSource()
        const orgs = await collect(source, makeQuery())

        expect(orgs).toHaveLength(0)
    })

    it('forces a fresh CSRF acquire after a step-2 5xx invalidates the cache', async () => {
        mockedAxios.request
            .mockResolvedValueOnce(tokenOnlyResponse() as any)             // search A: probe
            .mockResolvedValueOnce({ status: 500, data: '', headers: {} } as any)  // search A: step 2 fails
            .mockResolvedValueOnce(tokenOnlyResponse({ csrfToken: 'fresh' }) as any) // search B: re-acquire
            .mockResolvedValueOnce(featuresResponse(1) as any)               // search B: step 2

        const source = new YandexBusinessSource()
        await collect(source, makeQuery({ query: 'A' }))
        const orgsB = await collect(source, makeQuery({ query: 'B' }))

        expect(orgsB).toHaveLength(1)
        expect((mockedAxios.request.mock.calls[2][0] as any).url).toMatch(/text=%D0%BA%D0%B0%D1%84%D0%B5/)
        expect((mockedAxios.request.mock.calls[3][0] as any).url).toContain('csrfToken=fresh')
    })

    it('omits sessionId from step-2 URL when step-1 did not return one', async () => {
        mockedAxios.request
            .mockResolvedValueOnce({
                status: 200,
                data: { csrfToken: 'just-token' }, // no sessionId
                headers: { 'set-cookie': [] },
            } as any)
            .mockResolvedValueOnce(featuresResponse(1) as any)

        const source = new YandexBusinessSource()
        await collect(source, makeQuery())

        expect((mockedAxios.request.mock.calls[1][0] as any).url).not.toContain('sessionId=')
        expect((mockedAxios.request.mock.calls[1][0] as any).url).toContain('csrfToken=just-token')
    })
})
