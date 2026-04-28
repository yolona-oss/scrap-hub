import * as cheerio from "cheerio"
import { Tool } from "./types"
import { httpGet, httpPostForm, httpPostJson } from "../../http"
import { log } from "@cmd-hub/common"
import {
    getScraperSystemConfig,
    SCRAPER_COUNTRY,
    SCRAPER_LANGUAGE,
} from "../../../scraper-service/system-config"

export interface WebSearchResult {
    title: string
    url: string
    snippet: string
}

interface WebSearchResponse {
    results: WebSearchResult[]
    error?: string
    /** Which provider served the results (or last one tried). Useful for trace/debug. */
    provider?: string
}

interface SearchProvider {
    name: string
    isConfigured(cfg: Awaited<ReturnType<typeof getScraperSystemConfig>>): boolean
    search(
        query: string,
        limit: number,
        cfg: Awaited<ReturnType<typeof getScraperSystemConfig>>,
        signal?: AbortSignal,
    ): Promise<WebSearchResult[]>
}

export function makeWebSearchTool(): Tool {
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
        async handler(args, signal): Promise<WebSearchResponse> {
            const query = String(args?.query ?? '').trim()
            const limit = Math.min(Math.max(parseInt(args?.limit ?? 10), 1), 50)
            if (!query) return { results: [], error: 'empty query' }

            log.trace(`ai-agent.web_search: query="${query}" limit=${limit}`)
            const cfg = await getScraperSystemConfig()
            const errors: string[] = []
            for (const provider of PROVIDERS) {
                if (!provider.isConfigured(cfg)) continue
                try {
                    const results = await provider.search(query, limit, cfg, signal)
                    if (results.length > 0) {
                        log.debug(`ai-agent.web_search: ${results.length} results via ${provider.name}`)
                        return { results, provider: provider.name }
                    }
                    log.trace(`ai-agent.web_search: ${provider.name} returned 0 results, trying next`)
                } catch (e: any) {
                    const msg = String(e?.message ?? e)
                    log.trace(`ai-agent.web_search: ${provider.name} failed: ${msg}`)
                    errors.push(`${provider.name}: ${msg}`)
                }
            }
            const error = errors.length ? errors.join('; ') : 'no results from any provider'
            log.debug(`ai-agent.web_search: 0 results (${error})`)
            return { results: [], error }
        },
    }
}

/** Brave Search API — https://api.search.brave.com/res/v1/web/search */
const braveProvider: SearchProvider = {
    name: 'brave',
    isConfigured: cfg => Boolean(cfg.braveSearchApiKey),
    async search(query, limit, cfg, signal) {
        const params = new URLSearchParams({
            q: query,
            count: String(Math.min(limit, 20)),
            country: SCRAPER_COUNTRY.toLowerCase(),
            search_lang: SCRAPER_LANGUAGE,
        })
        const res = await httpGet(`https://api.search.brave.com/res/v1/web/search?${params}`, {
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': cfg.braveSearchApiKey!,
            },
            signal,
        })
        if (res.status >= 400) throw new Error(`brave http ${res.status}`)
        const data = res.data as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } }
        const items = data?.web?.results ?? []
        return items.slice(0, limit).flatMap(it =>
            it.title && it.url ? [{ title: it.title, url: it.url, snippet: it.description ?? '' }] : [],
        )
    },
}

/** Tavily Search API — https://api.tavily.com/search */
const tavilyProvider: SearchProvider = {
    name: 'tavily',
    isConfigured: cfg => Boolean(cfg.tavilyApiKey),
    async search(query, limit, cfg, signal) {
        const res = await httpPostJson(
            'https://api.tavily.com/search',
            {
                api_key: cfg.tavilyApiKey,
                query,
                max_results: Math.min(limit, 20),
                search_depth: 'basic',
            },
            { signal },
        )
        if (res.status >= 400) throw new Error(`tavily http ${res.status}`)
        const data = res.data as { results?: Array<{ title?: string; url?: string; content?: string }> }
        const items = data?.results ?? []
        return items.slice(0, limit).flatMap(it =>
            it.title && it.url ? [{ title: it.title, url: it.url, snippet: it.content ?? '' }] : [],
        )
    },
}

/** DuckDuckGo HTML scraper — last-ditch fallback. DDG now serves an
 *  anti-bot challenge page to non-browser TLS clients (HTTP 202 with an
 *  `anomaly-modal` element); we detect it and treat as zero-results so the
 *  caller knows to fall through. Kept as a fallback for environments without
 *  API keys; not reliable. */
const duckduckgoProvider: SearchProvider = {
    name: 'duckduckgo',
    isConfigured: () => true,
    async search(query, limit, _cfg, signal) {
        const res = await httpPostForm(
            'https://html.duckduckgo.com/html/',
            { q: query },
            { validateStatus: s => s < 500, signal },
        )
        const $ = cheerio.load(res.data)
        if ($('.anomaly-modal').length > 0) throw new Error('anomaly challenge')
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
        return results
    },
}

const PROVIDERS: SearchProvider[] = [braveProvider, tavilyProvider, duckduckgoProvider]
