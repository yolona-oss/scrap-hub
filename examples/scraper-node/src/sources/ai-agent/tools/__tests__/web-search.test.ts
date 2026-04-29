import axios from 'axios'

jest.mock('axios')
jest.mock('../../../../scraper-service/system-config', () => {
    const actual = jest.requireActual('../../../../scraper-service/system-config')
    return {
        ...actual,
        DEFAULT_USER_AGENT: 'test-ua',
        SCRAPER_ACCEPT_LANGUAGE: 'ru-RU,ru;q=0.9',
        getScraperSystemConfig: jest.fn(async () => ({
            chromePath: '',
            requestDelayMs: 0,
            userAgent: 'test-ua',
            searxngUrl: '',
        })),
    }
})

import { makeWebSearchTool } from '../web-search'
import { getScraperSystemConfig } from '../../../../scraper-service/system-config'
import { clearHttpConfigMemo } from '../../../http'

const mockedAxios = axios as jest.Mocked<typeof axios>
const mockedConfig = getScraperSystemConfig as jest.MockedFunction<typeof getScraperSystemConfig>

beforeEach(() => {
    jest.clearAllMocks()
    clearHttpConfigMemo()
    ;(mockedAxios.isAxiosError as unknown as jest.Mock).mockImplementation(
        (e: unknown) => Boolean(e && typeof e === 'object' && (e as any).isAxiosError === true),
    )
})

const tool = makeWebSearchTool()

const searxngBody = (n: number) => ({
    query: 'test',
    number_of_results: n,
    results: Array.from({ length: n }, (_, i) => ({
        title: `r${i}`,
        url: `https://example.com/${i}`,
        content: `snippet ${i}`,
        engine: 'duckduckgo',
    })),
})

describe('web_search tool', () => {
    it('returns empty result on empty query without hitting searxng', async () => {
        const out = await tool.handler({ query: '' })
        expect(out).toEqual({ results: [], error: 'empty query' })
        expect(mockedAxios.request).not.toHaveBeenCalled()
    })

    it('returns an explanatory error when searxngUrl is not configured', async () => {
        const out = await tool.handler({ query: 'foo' })
        expect(out.results).toEqual([])
        expect(out.error).toMatch(/searxngUrl not configured/)
        expect(mockedAxios.request).not.toHaveBeenCalled()
    })

    it('queries searxng JSON API and maps results', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            searxngUrl: 'http://127.0.0.1:8080',
        })
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: searxngBody(3) } as any)

        const out = await tool.handler({ query: 'Адвокат', limit: 5 })

        expect(out.results).toEqual([
            { title: 'r0', url: 'https://example.com/0', snippet: 'snippet 0' },
            { title: 'r1', url: 'https://example.com/1', snippet: 'snippet 1' },
            { title: 'r2', url: 'https://example.com/2', snippet: 'snippet 2' },
        ])
        expect(mockedAxios.request).toHaveBeenCalledTimes(1)
        const cfg = mockedAxios.request.mock.calls[0][0]!
        expect(cfg.url).toMatch(/^http:\/\/127\.0\.0\.1:8080\/search\?/)
        expect(cfg.url).toContain('format=json')
        expect(cfg.url).toContain('language=ru-RU')
        expect((cfg.headers as any).Accept).toBe('application/json')
    })

    it('caps results at the requested limit', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            searxngUrl: 'http://127.0.0.1:8080',
        })
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: searxngBody(15) } as any)

        const out = await tool.handler({ query: 'foo', limit: 5 })
        expect(out.results).toHaveLength(5)
    })

    it('strips trailing slashes from searxngUrl', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            searxngUrl: 'http://127.0.0.1:8080///',
        })
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: searxngBody(1) } as any)

        await tool.handler({ query: 'foo' })
        const cfg = mockedAxios.request.mock.calls[0][0]!
        expect(cfg.url).toMatch(/^http:\/\/127\.0\.0\.1:8080\/search\?/)
    })

    it('returns error on HTTP 4xx/5xx from searxng', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            searxngUrl: 'http://127.0.0.1:8080',
        })
        mockedAxios.request.mockResolvedValueOnce({ status: 500, data: '' } as any)

        const out = await tool.handler({ query: 'foo' })
        expect(out.results).toEqual([])
        expect(out.error).toMatch(/searxng http 500/)
    })

    it('drops items missing title or url', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            searxngUrl: 'http://127.0.0.1:8080',
        })
        mockedAxios.request.mockResolvedValueOnce({
            status: 200,
            data: {
                results: [
                    { title: 'ok', url: 'https://x.com', content: 'c' },
                    { title: '', url: 'https://no-title.com', content: 'c' },
                    { title: 'no url', url: '', content: 'c' },
                    { title: 'ok2', url: 'https://y.com' }, // no content
                ],
            },
        } as any)

        const out = await tool.handler({ query: 'foo' })
        expect(out.results).toEqual([
            { title: 'ok', url: 'https://x.com', snippet: 'c' },
            { title: 'ok2', url: 'https://y.com', snippet: '' },
        ])
    })
})
