import axios from "axios"
import * as cheerio from "cheerio"
import { Tool } from "./types"
import { getScraperConfig } from "../../../scraper-config"
import { log } from "@cmd-hub/common"

export interface WebSearchResult {
    title: string
    url: string
    snippet: string
}

interface WebSearchResponse {
    results: WebSearchResult[]
    error?: string
}

export function makeWebSearchTool(provider: 'serpapi' | 'yandex' | 'duckduckgo'): Tool {
    return {
        name: 'web_search',
        description: 'Search the web for information. Returns a list of results with title, url, and snippet.',
        parameters: {
            type: 'object',
            properties: {
                query: { type: 'string', description: 'Search query' },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            },
            required: ['query'],
        },
        async handler(args): Promise<WebSearchResponse> {
            const query = String(args?.query ?? '').trim()
            const limit = Math.min(Math.max(parseInt(args?.limit ?? 10), 1), 50)
            if (!query) return { results: [], error: 'empty query' }

            try {
                if (provider === 'serpapi') return await searchSerpapi(query, limit)
                if (provider === 'yandex') return await searchYandex(query, limit)
                return await searchDuckDuckGo(query, limit)
            } catch (e: any) {
                log.error(`ai-agent.web_search[${provider}]: ${e.message ?? e}`)
                return { results: [], error: String(e.message ?? e) }
            }
        },
    }
}

async function searchSerpapi(query: string, limit: number): Promise<WebSearchResponse> {
    const apiKey = (await getScraperConfig()).serpApiKey
    if (!apiKey) return { results: [], error: 'serpApiKey not configured' }

    const params = new URLSearchParams({
        api_key: apiKey,
        engine: 'google',
        q: query,
        num: String(limit),
        hl: 'ru',
        gl: 'ru',
    })
    const res = await axios.get(`https://serpapi.com/search.json?${params}`, { timeout: 15000 })
    const organic = (res.data?.organic_results ?? []) as any[]
    const results = organic.slice(0, limit).map(r => ({
        title: r.title ?? '',
        url: r.link ?? '',
        snippet: r.snippet ?? '',
    }))
    return { results }
}

async function searchYandex(query: string, limit: number): Promise<WebSearchResponse> {
    const cfg = await getScraperConfig()
    if (!cfg.yandexXmlUser || !cfg.yandexXmlKey) {
        return { results: [], error: 'yandex XML credentials not configured' }
    }
    const url = `https://yandex.ru/search/xml?user=${encodeURIComponent(cfg.yandexXmlUser)}&key=${encodeURIComponent(cfg.yandexXmlKey)}&query=${encodeURIComponent(query)}&l10n=ru&sortby=rlv&filter=none&groupby=attr%3Dd.mode%3Ddeep.groups-on-page%3D${limit}.docs-in-group%3D1`
    const res = await axios.get(url, { timeout: 15000 })
    const $ = cheerio.load(res.data, { xmlMode: true })
    const results: WebSearchResult[] = []
    $('doc').each((_, el) => {
        if (results.length >= limit) return
        const $el = $(el)
        results.push({
            title: $el.find('title').text().trim(),
            url: $el.find('url').text().trim(),
            snippet: $el.find('passage, headline').first().text().trim(),
        })
    })
    return { results }
}

async function searchDuckDuckGo(query: string, limit: number): Promise<WebSearchResponse> {
    const res = await axios.post(
        'https://html.duckduckgo.com/html/',
        new URLSearchParams({ q: query }).toString(),
        {
            timeout: 15000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            validateStatus: s => s < 500,
        },
    )
    const $ = cheerio.load(res.data)
    const results: WebSearchResult[] = []
    $('.result').each((_, el) => {
        if (results.length >= limit) return
        const $el = $(el)
        const a = $el.find('a.result__a').first()
        const url = a.attr('href') ?? ''
        const title = a.text().trim()
        const snippet = $el.find('.result__snippet').first().text().trim()
        if (title && url) results.push({ title, url, snippet })
    })
    return { results }
}
