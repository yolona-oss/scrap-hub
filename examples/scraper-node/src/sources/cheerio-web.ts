import { IScraperSource, SourceAvailability } from "./types"
import { OrgData, SearchQuery } from "../types"
import type { ServiceContext } from "../exporters/types"
import { resolveScraperUserConfig } from "../scraper-config"
import { extractEmail, extractPhone } from "./extract"
import { extractFromElement } from "./cheerio-extract"
import { httpGet, httpHead, isHttpError } from "./http"
import * as cheerio from "cheerio"
import { log, randSleep } from "@cmd-hub/common"

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
    /** Optional explicit availability probe URL. If omitted, a HEAD against
     *  `urlTemplate` with empty `{query}/{city}/{page}` is used. */
    probeUrl?: string
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
        const probeUrl = this.config.probeUrl ?? this.config.urlTemplate
            .replace('{query}', '')
            .replace('{city}', '')
            .replace('{page}', '1')
        try {
            const res = await httpHead(probeUrl, { timeoutMs: 5000, retries: 1 })
            if (res.status >= 400) {
                return { ok: false, reason: `probe ${probeUrl}: HTTP ${res.status}` }
            }
            return { ok: true }
        } catch (e: any) {
            return { ok: false, reason: `probe ${probeUrl}: ${e?.message ?? e}` }
        }
    }

    async* search(query: SearchQuery, onProgress: (found: number) => void, context?: ServiceContext): AsyncGenerator<OrgData> {
        const userMerged = await resolveScraperUserConfig(context)
        const maxPages = this.config.maxPages ?? 10
        const interPageDelayMs = this.config.delayMs ?? userMerged.requestDelayMs
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
                const res = await httpGet(url, {
                    headers: this.config.headers,
                    validateStatus: s => s < 500,
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

                    const name = extractFromElement($item, sel.name, mode.name)
                    if (!name) continue

                    const rawText = $item.text()

                    const org: OrgData = {
                        name,
                        source: this.name,
                        email: sel.email ? extractFromElement($item, sel.email, mode.email) : extractEmail(rawText),
                        phone: sel.phone ? extractFromElement($item, sel.phone, mode.phone) : extractPhone(rawText),
                        address: sel.address ? extractFromElement($item, sel.address, mode.address) : null,
                        url: (sel.url ? extractFromElement($item, sel.url, mode.url) : undefined) ?? undefined,
                    }

                    found++
                    onProgress(found)
                    yield org

                    if (found >= query.maxResults) return
                }

                // Inter-page delay (jittered) on top of the global throttler so
                // listing pagination doesn't hit one site like a synchronized
                // burst across a back-to-back run.
                if (page < maxPages) {
                    await randSleep(interPageDelayMs + 1000, interPageDelayMs)
                }
            } catch (e: any) {
                if (isHttpError(e, 403)) {
                    log.warn(`cheerio-web[${this.name}].search: 403 — likely rate-limited or blocked`)
                    break
                }
                log.error(`cheerio-web[${this.name}].search: page=${page}: ${e.message ?? e}`)
                break
            }
        }
        log.info(`cheerio-web[${this.name}].search: done found=${found}`)
    }
}
