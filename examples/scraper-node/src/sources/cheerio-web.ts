import { IScraperSource, SourceAvailability } from "./types"
import { OrgData, SearchQuery } from "../types"
import { DEFAULT_USER_AGENT, getScraperConfig } from "../scraper-config"
import { extractEmail, extractPhone } from "./extract"
import * as cheerio from "cheerio"
import axios from "axios"
import { log } from "@cmd-hub/common"

/**
 * Configuration for a cheerio-based web scraper source.
 * Define CSS selectors to extract org data from any website.
 */
export interface CheerioSourceConfig {
    /** Source display name */
    name: string
    /** URL template. Use {query}, {city}, {page} placeholders */
    urlTemplate: string
    /** CSS selector for each organization item on the page */
    itemSelector: string
    /** CSS selectors for fields within each item (relative to itemSelector) */
    selectors: {
        name: string
        email?: string
        phone?: string
        address?: string
        url?: string
    }
    /** How to extract the value: 'text' (default), 'href', 'src', or an attribute name */
    extractMode?: {
        name?: string
        email?: string
        phone?: string
        address?: string
        url?: string
    }
    /** Max pages to scrape (default: 10) */
    maxPages?: number
    /** Delay between page requests in ms (default: from config or 1500) */
    delayMs?: number
    /** Custom headers */
    headers?: Record<string, string>
}

function extractValue($el: cheerio.Cheerio<any>, selector: string, mode?: string): string | null {
    const el = $el.find(selector)
    if (el.length === 0) return null

    switch (mode) {
        case 'href': return el.attr('href') || null
        case 'src': return el.attr('src') || null
        case 'text': return el.text().trim() || null
        default:
            if (mode) return el.attr(mode) || null
            return el.text().trim() || null
    }
}

/**
 * Generic cheerio-based web scraper source.
 * Configure with CSS selectors to scrape any website.
 */
export class CheerioWebSource implements IScraperSource {
    readonly name: string

    constructor(private config: CheerioSourceConfig) {
        this.name = config.name
    }

    async availability(): Promise<SourceAvailability> {
        return { ok: true }
    }

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const scraperCfg = await getScraperConfig()
        const userAgent = scraperCfg.userAgent || DEFAULT_USER_AGENT

        const maxPages = this.config.maxPages ?? 10
        const delayMs = this.config.delayMs ?? scraperCfg.requestDelayMs ?? 1500
        log.info(`cheerio-web[${this.name}].search: query="${query.query}" city="${query.city ?? ''}" maxResults=${query.maxResults} maxPages=${maxPages}`)
        let found = 0

        for (let page = 1; page <= maxPages; page++) {
            const searchQuery = query.city
                ? `${query.query} ${query.city}`
                : query.query

            const url = this.config.urlTemplate
                .replace('{query}', encodeURIComponent(searchQuery))
                .replace('{city}', encodeURIComponent(query.city ?? ''))
                .replace('{page}', String(page))

            log.trace(`cheerio-web[${this.name}].search: fetching ${url}`)

            try {
                const res = await axios.get(url, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': userAgent,
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'ru-RU,ru;q=0.9',
                        ...this.config.headers,
                    },
                    validateStatus: (status) => status < 500,
                })

                if (res.status >= 400) {
                    log.warn(`cheerio-web[${this.name}].search: HTTP ${res.status} for ${url}`)
                    break
                }

                const $ = cheerio.load(res.data)
                const items = $(this.config.itemSelector)

                if (items.length === 0) {
                    log.trace(`cheerio-web[${this.name}].search: no items on page ${page}`)
                    break
                }
                log.trace(`cheerio-web[${this.name}].search: page=${page} items=${items.length}`)

                for (let i = 0; i < items.length; i++) {
                    const $item = $(items[i])
                    const sel = this.config.selectors
                    const mode = this.config.extractMode ?? {}

                    const name = extractValue($item, sel.name, mode.name)
                    if (!name) continue

                    const rawText = $item.text()

                    const org: OrgData = {
                        name,
                        source: this.name,
                        email: sel.email ? extractValue($item, sel.email, mode.email) : extractEmail(rawText),
                        phone: sel.phone ? extractValue($item, sel.phone, mode.phone) : extractPhone(rawText),
                        address: sel.address ? extractValue($item, sel.address, mode.address) : null,
                        url: (sel.url ? extractValue($item, sel.url, mode.url) : undefined) ?? undefined,
                    }

                    found++
                    onProgress(found)
                    yield org

                    if (found >= query.maxResults) return
                }

                // Delay between pages
                if (page < maxPages) {
                    await new Promise(r => setTimeout(r, delayMs + Math.random() * 1000))
                }
            } catch (e: any) {
                log.error(`cheerio-web[${this.name}].search: page=${page}: ${e.message ?? e}`)
                break
            }
        }
        log.info(`cheerio-web[${this.name}].search: done found=${found}`)
    }
}
