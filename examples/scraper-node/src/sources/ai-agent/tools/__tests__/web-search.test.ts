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
            braveSearchApiKey: '',
            tavilyApiKey: '',
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

const braveBody = (n: number) => ({
    web: {
        results: Array.from({ length: n }, (_, i) => ({
            title: `brave ${i}`,
            url: `https://brave.example/${i}`,
            description: `snippet ${i}`,
        })),
    },
})

const tavilyBody = (n: number) => ({
    results: Array.from({ length: n }, (_, i) => ({
        title: `tav ${i}`,
        url: `https://tav.example/${i}`,
        content: `content ${i}`,
    })),
})

const ddgHtml = (n: number) => `<html><body>${
    Array.from({ length: n }, (_, i) =>
        `<div class="result"><a class="result__a" href="https://ddg.example/${i}">ddg ${i}</a><div class="result__snippet">s${i}</div></div>`,
    ).join('')
}</body></html>`

const anomalyHtml = '<html><body><div class="anomaly-modal"></div></body></html>'

describe('web_search tool', () => {
    it('returns empty result on empty query without hitting any provider', async () => {
        const out = await tool.handler({ query: '' })
        expect(out).toEqual({ results: [], error: 'empty query' })
        expect(mockedAxios.request).not.toHaveBeenCalled()
    })

    it('uses Brave first when its key is configured', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            braveSearchApiKey: 'brave-key', tavilyApiKey: 'tav-key',
        })
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: braveBody(3) } as any)
        const out = await tool.handler({ query: 'foo', limit: 5 })
        expect(out.provider).toBe('brave')
        expect(out.results).toHaveLength(3)
        expect(out.results[0].url).toBe('https://brave.example/0')
        expect(mockedAxios.request).toHaveBeenCalledTimes(1)
        const cfg = mockedAxios.request.mock.calls[0][0]!
        expect(cfg.url).toContain('api.search.brave.com')
        expect((cfg.headers as any)['X-Subscription-Token']).toBe('brave-key')
    })

    it('falls through to Tavily when Brave returns 0 results', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            braveSearchApiKey: 'brave-key', tavilyApiKey: 'tav-key',
        })
        mockedAxios.request
            .mockResolvedValueOnce({ status: 200, data: braveBody(0) } as any)
            .mockResolvedValueOnce({ status: 200, data: tavilyBody(2) } as any)
        const out = await tool.handler({ query: 'foo' })
        expect(out.provider).toBe('tavily')
        expect(out.results.map((r: { url: string }) => r.url)).toEqual([
            'https://tav.example/0', 'https://tav.example/1',
        ])
        expect(mockedAxios.request).toHaveBeenCalledTimes(2)
    })

    it('falls through to Tavily when Brave throws', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            braveSearchApiKey: 'brave-key', tavilyApiKey: 'tav-key',
        })
        mockedAxios.request
            .mockResolvedValueOnce({ status: 500, data: '' } as any) // brave -> handler throws
            .mockResolvedValueOnce({ status: 200, data: tavilyBody(1) } as any)
        const out = await tool.handler({ query: 'foo' })
        expect(out.provider).toBe('tavily')
        expect(out.results).toHaveLength(1)
    })

    it('skips unconfigured Brave/Tavily and uses DuckDuckGo', async () => {
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: ddgHtml(2) } as any)
        const out = await tool.handler({ query: 'foo' })
        expect(out.provider).toBe('duckduckgo')
        expect(out.results.map((r: { url: string }) => r.url)).toEqual([
            'https://ddg.example/0', 'https://ddg.example/1',
        ])
        expect(mockedAxios.request).toHaveBeenCalledTimes(1)
    })

    it('treats DuckDuckGo anomaly page as a failure (no results, error reported)', async () => {
        mockedAxios.request.mockResolvedValueOnce({ status: 202, data: anomalyHtml } as any)
        const out = await tool.handler({ query: 'foo' })
        expect(out.results).toEqual([])
        expect(out.error).toContain('duckduckgo')
        expect(out.error).toContain('anomaly')
    })

    it('caps results at the requested limit', async () => {
        mockedConfig.mockResolvedValueOnce({
            chromePath: '', requestDelayMs: 0, userAgent: 'test-ua',
            braveSearchApiKey: 'brave-key',
        })
        mockedAxios.request.mockResolvedValueOnce({ status: 200, data: braveBody(15) } as any)
        const out = await tool.handler({ query: 'foo', limit: 5 })
        expect(out.results).toHaveLength(5)
    })
})
