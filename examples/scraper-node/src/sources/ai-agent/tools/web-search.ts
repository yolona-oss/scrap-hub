import * as cheerio from "cheerio"
import { Tool } from "./types"
import { httpPostForm } from "../../http"
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
            try {
                const res = await searchDuckDuckGo(query, limit, signal)
                log.debug(`ai-agent.web_search: ${res.results.length} results${res.error ? ` (error: ${res.error})` : ''}`)
                return res
            } catch (e: any) {
                log.error(`ai-agent.web_search: ${e.message ?? e}`)
                return { results: [], error: String(e.message ?? e) }
            }
        },
    }
}

async function searchDuckDuckGo(query: string, limit: number, signal?: AbortSignal): Promise<WebSearchResponse> {
    const res = await httpPostForm(
        'https://html.duckduckgo.com/html/',
        { q: query },
        { validateStatus: s => s < 500, signal },
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
