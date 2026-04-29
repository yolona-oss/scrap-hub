import * as cheerio from "cheerio"
import { Tool } from "./types"
import { httpGet } from "../../http"
import { log } from "@cmd-hub/common"

const MAX_CONTENT_CHARS = 15_000

interface FetchResult {
    status: number
    content: string
    truncated: boolean
    error?: string
    hint?: string
}

export function buildFetchUrlHint(
    result: { status: number, content: string, truncated: boolean, error?: string },
    mode: 'text' | 'html',
): string | undefined {
    if (result.status >= 400 || result.status === 0) {
        return 'page unavailable — skip this URL, try the next search result'
    }
    if (mode === 'html') {
        if (result.content.length < 500) return 'thin page — likely SPA or 404 disguised as 200; skip'
        return 'now call extract_contacts(html) to pull tel/mailto/address in one step'
    }
    const hasMarker = /@|\+7|тел/i.test(result.content)
    return hasMarker
        ? 'contacts visible in text — call report_results directly with the extracted org'
        : "no contact markers in extracted text — try mode='html' to inspect markup, or skip this page"
}

export function makeFetchUrlTool(): Tool {
    return {
        name: 'fetch_url',
        description: 'Fetch a web page. Returns extracted text (mode=text) or raw HTML (mode=html), truncated to 15000 chars. For HTML extraction use parse_html — do not substring-search HTML yourself.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                mode: { type: 'string', enum: ['text', 'html'], default: 'text' },
            },
            required: ['url'],
        },
        async handler(args, signal): Promise<FetchResult> {
            const url = String(args?.url ?? '').trim()
            const mode: 'text' | 'html' = args?.mode === 'html' ? 'html' : 'text'
            if (!url) return { status: 0, content: '', truncated: false, error: 'empty url' }

            log.trace(`ai-agent.fetch_url: ${url} mode=${mode}`)
            try {
                const res = await httpGet(url, {
                    headers: { 'Accept': 'text/html,application/xhtml+xml' },
                    validateStatus: s => s < 600,
                    signal,
                })

                const status = res.status
                if (status >= 400) {
                    log.debug(`ai-agent.fetch_url: ${url} HTTP ${status}`)
                    const r = { status, content: '', truncated: false, error: `HTTP ${status}` }
                    return { ...r, hint: buildFetchUrlHint(r, mode) }
                }

                const body = typeof res.data === 'string' ? res.data : String(res.data ?? '')
                let content: string
                if (mode === 'html') {
                    content = body
                } else {
                    const $ = cheerio.load(body)
                    $('script, style, noscript').remove()
                    content = $('body').text().replace(/\s+/g, ' ').trim()
                }

                const truncated = content.length > MAX_CONTENT_CHARS
                if (truncated) content = content.slice(0, MAX_CONTENT_CHARS)
                log.debug(`ai-agent.fetch_url: ${url} ${status} ${content.length}ch${truncated ? ' (truncated)' : ''}`)
                const r = { status, content, truncated }
                return { ...r, hint: buildFetchUrlHint(r, mode) }
            } catch (e: any) {
                log.warn(`ai-agent.fetch_url: ${url}: ${e.message ?? e}`)
                const r = { status: 0, content: '', truncated: false, error: String(e.message ?? e) }
                return { ...r, hint: buildFetchUrlHint(r, mode) }
            }
        },
    }
}
