import { IScraperSource, SourceAvailability } from "./types"
import { OrgData, SearchQuery } from "../types"
import { SCRAPER_LANGUAGE } from "../scraper-defaults"
import { httpGet, httpHead } from "./http"
import { log } from "@cmd-hub/common"

const YANDEX_MAPS_BASE = 'https://yandex.ru/maps'
const YANDEX_MAPS_API = `${YANDEX_MAPS_BASE}/api/search`

export class YandexBusinessSource implements IScraperSource {
    async availability(): Promise<SourceAvailability> {
        // HEAD the homepage, NOT the API endpoint — probing /api/search would
        // burn quota with each /scrape (the AI-agent calls availability before
        // every search_source).
        try {
            const res = await httpHead(`${YANDEX_MAPS_BASE}/`, { timeoutMs: 5000, retries: 1 })
            if (res.status >= 400) {
                return { ok: false, reason: `yandex maps HEAD: HTTP ${res.status}` }
            }
            return { ok: true }
        } catch (e: any) {
            return { ok: false, reason: `yandex maps HEAD: ${e?.message ?? e}` }
        }
    }

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        log.info(`yandex-business.search: query="${searchQuery}" maxResults=${query.maxResults}`)
        let found = 0

        try {
            const params = new URLSearchParams({
                text: searchQuery,
                type: 'biz',
                lang: `${SCRAPER_LANGUAGE}_RU`,
                results: String(Math.min(query.maxResults, 50)),
            })

            const res = await httpGet(`${YANDEX_MAPS_API}?${params}`, {
                headers: {
                    'Accept': 'application/json',
                    'Referer': `${YANDEX_MAPS_BASE}/`,
                },
            })

            const data = res.data
            const features = data?.features || data?.data?.features || []
            log.trace(`yandex-business.search: ${features.length} features in response`)

            for (const feature of features) {
                const props = feature?.properties?.CompanyMetaData || feature?.properties || {}
                const name = props.name || props.Names?.find((n: any) => n.type === 'main')?.value || ''
                if (!name) continue

                const phones = props.Phones || []
                const phone = phones.length > 0
                    ? phones[0].formatted || phones[0].number || null
                    : null

                const address = props.address || props.Address?.formatted || null
                const url = props.url || null

                let email: string | null = null
                const links = props.Links || []
                for (const link of links) {
                    if (link.type === 'email' || (link.href && link.href.includes('@'))) {
                        email = link.href?.replace('mailto:', '') || null
                        break
                    }
                }

                const org: OrgData = {
                    name,
                    source: 'Yandex Business',
                    email,
                    phone,
                    address,
                    url,
                }

                found++
                onProgress(found)
                yield org

                if (found >= query.maxResults) break
            }
        } catch (e: any) {
            log.error(`yandex-business.search: ${e.message ?? e}`)
            log.info("yandex-business.search: may require Puppeteer for reliable scraping")
        }
        log.info(`yandex-business.search: done found=${found}`)
    }
}
