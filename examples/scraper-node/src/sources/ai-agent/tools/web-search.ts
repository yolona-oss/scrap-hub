import { Tool } from "./types"
import { httpGet } from "../../http"
import { log } from "@cmd-hub/common"
import {
    getScraperSystemConfig,
    SCRAPER_COUNTRY,
    SCRAPER_LANGUAGE,
} from "../../../scraper-service/system-config"
import { normalizeSearchQuery } from "../../city-query"
import type { SearchQuery } from "../../../types"

export interface WebSearchResult {
    title: string
    url: string
    snippet: string
}

interface WebSearchResponse {
    results: WebSearchResult[]
    error?: string
    hint?: string
}

const AGGREGATOR_DOMAINS = [
    '2gis.ru', 'yell.ru', 'zoon.ru', 'yandex.ru', 'yandex.com',
    'spravochnik.org', 'orgpage.ru', 'rusprofile.ru', 'list-org.com',
]

function isAggregatorDomain(url: string): boolean {
    try {
        const host = new URL(url).hostname.toLowerCase()
        return AGGREGATOR_DOMAINS.some(d => host === d || host.endsWith('.' + d))
    } catch {
        return false
    }
}

export function buildWebSearchHint(results: WebSearchResult[], error?: string): string | undefined {
    if (results.length === 0) {
        return error
            ? 'search backend failed — try a different query phrasing or fall back to search_source'
            : 'no results — try synonyms or related terms (e.g. broader category, English transliteration, professional jargon)'
    }
    if (results.length < 3) return undefined
    const aggregatorCount = results.filter(r => isAggregatorDomain(r.url)).length
    if (aggregatorCount / results.length > 0.5) {
        return "aggregator-heavy results — search_source('yandex-business') will be cheaper than scraping these one by one"
    }
    return 'diverse results — fetch the top 2-3 for direct contact extraction'
}

interface SearxngResult {
    title?: string
    url?: string
    content?: string
}

interface SearxngResponse {
    results?: SearxngResult[]
    unresponsive_engines?: unknown[]
}

export function makeWebSearchTool(baseQuery?: Pick<SearchQuery, 'city'>): Tool {
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
            const rawQuery = String(args?.query ?? '').trim()
            const limit = Math.min(Math.max(parseInt(args?.limit ?? 10), 1), 50)
            if (!rawQuery) return { results: [], error: 'empty query' }

            // Force the search to use the user's --city, regardless of what
            // the model wrote. Strips any other Russian-city tokens from the
            // model's query and appends the target city. No-op when city is
            // unset.
            const query = normalizeSearchQuery(rawQuery, baseQuery?.city)

            log.trace(`ai-agent.web_search: query="${query}" limit=${limit}` +
                (rawQuery !== query ? ` (rewritten from "${rawQuery}")` : ''))
            const cfg = await getScraperSystemConfig()
            const baseUrl = (cfg.searxngUrl ?? '').trim().replace(/\/+$/, '')
            if (!baseUrl) {
                const error = 'searxngUrl not configured (set scraper.searxngUrl in node config)'
                log.debug(`ai-agent.web_search: ${error}`)
                return { results: [], error }
            }

            try {
                const results = await searchSearxng(baseUrl, query, limit, signal)
                log.debug(`ai-agent.web_search: ${results.length} results via searxng`)
                const hint = buildWebSearchHint(results)
                return hint ? { results, hint } : { results }
            } catch (e: any) {
                const error = String(e?.message ?? e)
                log.debug(`ai-agent.web_search: 0 results (searxng: ${error})`)
                const hint = buildWebSearchHint([], error)
                return { results: [], error, hint }
            }
        },
    }
}

async function searchSearxng(
    baseUrl: string,
    query: string,
    limit: number,
    signal?: AbortSignal,
): Promise<WebSearchResult[]> {
    const params = new URLSearchParams({
        q: query,
        format: 'json',
        language: `${SCRAPER_LANGUAGE}-${SCRAPER_COUNTRY}`,
        safesearch: '0',
    })
    const res = await httpGet(`${baseUrl}/search?${params}`, {
        headers: { 'Accept': 'application/json' },
        signal,
    })
    if (res.status >= 400) throw new Error(`searxng http ${res.status}`)
    const data = res.data as SearxngResponse
    const items = data?.results ?? []
    return items.slice(0, limit).flatMap(it =>
        it.title && it.url ? [{ title: it.title, url: it.url, snippet: it.content ?? '' }] : [],
    )
}
