import * as cheerio from "cheerio"
import { Tool } from "./types"
import { readNode } from "../../cheerio-extract"
import { log } from "@cmd-hub/common"

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

interface ParseHtmlResult {
    matches: string[]
    count: number
    truncated: boolean
    error?: string
}

/** Apply a CSS selector to HTML returned by `fetch_url(mode=html)`. Cheaper
 *  and more reliable than getting the model to substring-search 15KB of
 *  markup. */
export function makeParseHtmlTool(): Tool {
    return {
        name: 'parse_html',
        description: "Apply a CSS selector to HTML (use after fetch_url with mode='html'). Returns matched node text/attributes. Always use this rather than substring-searching HTML yourself.",
        parameters: {
            type: 'object',
            properties: {
                html: { type: 'string', description: 'HTML body returned by fetch_url(mode=html)' },
                selector: { type: 'string', description: 'CSS selector e.g. ".product-card .title" or "a[href*=\\\"contact\\\"]"' },
                extract: {
                    type: 'string',
                    description: "What to extract from each match: 'text' (default), 'html' (inner HTML), 'href', 'src', or any other attribute name (e.g. 'data-id').",
                    default: 'text',
                },
                limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT, default: DEFAULT_LIMIT },
            },
            required: ['html', 'selector'],
        },
        async handler(args): Promise<ParseHtmlResult> {
            const html = String(args?.html ?? '')
            const selector = String(args?.selector ?? '').trim()
            const extract = String(args?.extract ?? 'text').trim() || 'text'
            const limit = Math.min(Math.max(parseInt(args?.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT)

            if (!html) return { matches: [], count: 0, truncated: false, error: 'empty html' }
            if (!selector) return { matches: [], count: 0, truncated: false, error: 'empty selector' }

            try {
                const $ = cheerio.load(html)
                const found = $(selector)
                const matches: string[] = []
                found.each((_, el) => {
                    if (matches.length >= limit) return false
                    const value = readNode($(el), extract)
                    if (value) matches.push(value)
                    return undefined
                })

                const truncated = found.length > matches.length
                log.debug(`ai-agent.parse_html: selector="${selector}" extract=${extract} matches=${matches.length}/${found.length}${truncated ? ' (truncated)' : ''}`)
                return { matches, count: matches.length, truncated }
            } catch (e: any) {
                log.warn(`ai-agent.parse_html: ${e.message ?? e}`)
                return { matches: [], count: 0, truncated: false, error: String(e.message ?? e) }
            }
        },
    }
}
