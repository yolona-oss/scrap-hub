import { IScraperSource, SourceAvailability } from "./types"
import { OrgData, SearchQuery } from "../types"
import { DEFAULT_USER_AGENT, getScraperConfig } from "../scraper-config"
import axios from "axios"
import { log } from "@cmd-hub/common"

export class YandexBusinessSource implements IScraperSource {
    async availability(): Promise<SourceAvailability> {
        return { ok: true }
    }

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        log.info(`yandex-business.search: query="${searchQuery}" maxResults=${query.maxResults}`)
        let found = 0
        const userAgent = (await getScraperConfig()).userAgent || DEFAULT_USER_AGENT

        try {
            const params = new URLSearchParams({
                text: searchQuery,
                type: 'biz',
                lang: 'ru_RU',
                results: String(Math.min(query.maxResults, 50)),
            })

            const res = await axios.get(`https://yandex.ru/maps/api/search?${params}`, {
                timeout: 15000,
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'application/json',
                    'Referer': 'https://yandex.ru/maps/',
                }
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
