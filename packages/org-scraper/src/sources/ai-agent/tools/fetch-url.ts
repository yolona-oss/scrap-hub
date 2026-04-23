import axios from "axios"
import * as cheerio from "cheerio"
import { Tool } from "./types"
import log from "@logger"

const MAX_CONTENT_CHARS = 15_000

interface FetchResult {
    status: number
    content: string
    truncated: boolean
    error?: string
}

export function makeFetchUrlTool(): Tool {
    return {
        name: 'fetch_url',
        description: 'Fetch a web page. Returns extracted text (mode=text) or raw HTML (mode=html), truncated to 15000 chars.',
        parameters: {
            type: 'object',
            properties: {
                url: { type: 'string' },
                mode: { type: 'string', enum: ['text', 'html'], default: 'text' },
            },
            required: ['url'],
        },
        async handler(args): Promise<FetchResult> {
            const url = String(args?.url ?? '').trim()
            const mode: 'text' | 'html' = args?.mode === 'html' ? 'html' : 'text'
            if (!url) return { status: 0, content: '', truncated: false, error: 'empty url' }

            try {
                const res = await axios.get(url, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'ru-RU,ru;q=0.9',
                    },
                    maxContentLength: 5_000_000,
                    validateStatus: s => s < 600,
                })

                const status = res.status
                if (status >= 400) {
                    return { status, content: '', truncated: false, error: `HTTP ${status}` }
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
                return { status, content, truncated }
            } catch (e: any) {
                log.debug(`ai-agent.fetch_url: ${url}: ${e.message ?? e}`)
                return { status: 0, content: '', truncated: false, error: String(e.message ?? e) }
            }
        },
    }
}
