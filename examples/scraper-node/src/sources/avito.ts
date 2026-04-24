import { IScraperSource } from "./types"
import { OrgData, SearchQuery } from "../types"
import { getScraperConfig } from "../scraper-config"
import * as cheerio from "cheerio"
import axios from "axios"
import log from "@logger"

export class AvitoSource implements IScraperSource {
    readonly name = 'avito'
    readonly requiresApiKey = false

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        let found = 0
        let page = 1
        const userAgent = (await getScraperConfig()).userAgent
            || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

        while (found < query.maxResults) {
            try {
                const searchUrl = `https://www.avito.ru/all/predlozheniya_uslug?q=${encodeURIComponent(searchQuery)}&p=${page}`

                const res = await axios.get(searchUrl, {
                    timeout: 15000,
                    headers: {
                        'User-Agent': userAgent,
                        'Accept': 'text/html,application/xhtml+xml',
                        'Accept-Language': 'ru-RU,ru;q=0.9',
                    },
                    proxy: false, // use env proxy via axios defaults if configured
                    validateStatus: (status) => status < 500,
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
                        url: link ? `https://www.avito.ru${link}` : undefined,
                    }

                    found++
                    onProgress(found)
                    yield org

                    if (found >= query.maxResults) break
                }

                page++
                // Rate limit — Avito blocks aggressive scraping
                await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000))
            } catch (e: any) {
                if (axios.isAxiosError(e) && e.response?.status === 403) {
                    log.warn("Avito returned 403 — likely rate-limited or blocked")
                    break
                }
                log.error(`Avito search error: ${e.message ?? e}`)
                break
            }
        }
    }
}
