import { IScraperSource, SourceAvailability } from "./types"
import { OrgData, SearchQuery } from "../types"
import { httpGet, httpHead, isHttpError } from "./http"
import * as cheerio from "cheerio"
import { log, randSleep } from "@cmd-hub/common"

const AVITO_BASE = 'https://www.avito.ru'
const AVITO_LISTINGS_PATH = '/all/predlozheniya_uslug'
/** Avito blocks aggressive scraping; jittered inter-page delay on top of
 *  the shared throttler reduces fingerprinting. */
const INTER_PAGE_DELAY_MIN_MS = 2000
const INTER_PAGE_DELAY_MAX_MS = 4000

export class AvitoSource implements IScraperSource {
    async availability(): Promise<SourceAvailability> {
        try {
            const res = await httpHead(AVITO_BASE, { timeoutMs: 5000, retries: 1 })
            if (res.status >= 400) {
                return { ok: false, reason: `avito.ru HEAD: HTTP ${res.status}` }
            }
            return { ok: true }
        } catch (e: any) {
            return { ok: false, reason: `avito.ru HEAD: ${e?.message ?? e}` }
        }
    }

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        log.info(`avito.search: query="${searchQuery}" maxResults=${query.maxResults}`)
        let found = 0
        let page = 1

        while (found < query.maxResults) {
            log.trace(`avito.search: page=${page} found=${found}`)
            try {
                const searchUrl = `${AVITO_BASE}${AVITO_LISTINGS_PATH}?q=${encodeURIComponent(searchQuery)}&p=${page}`

                const res = await httpGet(searchUrl, {
                    proxy: false,
                    validateStatus: s => s < 500,
                })

                const $ = cheerio.load(res.data)
                const items = $('[data-marker="item"]')

                if (items.length === 0) break

                for (let i = 0; i < items.length; i++) {
                    const item = items.eq(i)
                    const title = item.find('[itemprop="name"]').text().trim()
                        || item.find('[data-marker="item-title"]').text().trim()
                    const link = item.find('a[itemprop="url"]').attr('href')
                        || item.find('[data-marker="item-title"] a').attr('href')
                    const address = item.find('[class*="geo"]').text().trim()
                        || item.find('[data-marker="item-address"]').text().trim()

                    if (!title) continue

                    const org: OrgData = {
                        name: title,
                        source: 'Avito',
                        email: null,
                        phone: null,  // Avito hides phones behind auth
                        address: address || null,
                        url: link ? `${AVITO_BASE}${link}` : undefined,
                    }

                    found++
                    onProgress(found)
                    yield org

                    if (found >= query.maxResults) break
                }

                page++
                await randSleep(INTER_PAGE_DELAY_MAX_MS, INTER_PAGE_DELAY_MIN_MS)
            } catch (e: any) {
                if (isHttpError(e, 403)) {
                    log.warn("avito.search: 403 — likely rate-limited or blocked")
                    break
                }
                log.error(`avito.search: ${e.message ?? e}`)
                break
            }
        }
        log.info(`avito.search: done found=${found}`)
    }
}
