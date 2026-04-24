import { IScraperSource } from "./types"
import { OrgData, SearchQuery } from "../types"
import { getScraperConfig } from "../scraper-config"
import axios from "axios"
import log from "@logger"

export class YandexBusinessSource implements IScraperSource {
    readonly name = 'yandex-business'
    readonly requiresApiKey = false

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        let found = 0
        const userAgent = (await getScraperConfig()).userAgent
            || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

        try {
            // Yandex Maps API (public search endpoint)
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
            log.error(`Yandex Business error: ${e.message ?? e}`)
            // Yandex Maps may block — this is expected without proper API access
            log.info("Yandex Business may require Puppeteer for reliable scraping")
        }
    }
}
