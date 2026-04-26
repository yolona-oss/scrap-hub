import { IScraperSource, SourceAvailability } from "./types"
import { OrgData, SearchQuery } from "../types"
import { getScraperConfig } from "../scraper-config"
import { SCRAPER_LANGUAGE } from "../scraper-defaults"
import { extractEmail, extractPhone, extractAddress } from "./extract"
import { httpGet } from "./http"
import { log, sleep } from "@cmd-hub/common"

export class GoogleSearchSource implements IScraperSource {
    async availability(): Promise<SourceAvailability> {
        const apiKey = (await getScraperConfig()).serpApiKey
        if (!apiKey) return { ok: false, reason: 'scraper.serpApiKey not configured' }
        return { ok: true }
    }

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const apiKey = (await getScraperConfig()).serpApiKey
        if (!apiKey) throw new Error('scraper.serpApiKey not configured')

        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        log.info(`google.search: query="${searchQuery}" maxResults=${query.maxResults}`)
        let start = 0
        let found = 0
        const perPage = 10

        while (found < query.maxResults) {
            log.trace(`google.search: page start=${start} found=${found}`)
            try {
                const params = new URLSearchParams({
                    api_key: apiKey,
                    engine: 'google',
                    q: searchQuery,
                    start: String(start),
                    num: String(perPage),
                    hl: SCRAPER_LANGUAGE,
                    gl: SCRAPER_LANGUAGE,
                })

                const res = await httpGet(`https://serpapi.com/search.json?${params}`)
                if (res.status >= 400) {
                    log.error(`SerpAPI error: ${res.status}`)
                    break
                }

                const data = res.data

                // Extract from local results (business listings)
                const localResults = data.local_results?.places || data.local_results || []
                for (const place of (Array.isArray(localResults) ? localResults : [])) {
                    const org: OrgData = {
                        name: place.title || place.name || '',
                        source: 'Google',
                        email: null,
                        phone: place.phone || null,
                        address: place.address || null,
                        url: place.link || place.website || undefined,
                    }
                    if (org.name) {
                        found++
                        onProgress(found)
                        yield org
                    }
                }

                // Extract from organic results
                const organicResults = data.organic_results || []
                for (const result of organicResults) {
                    const snippet = result.snippet || ''
                    const org: OrgData = {
                        name: result.title || '',
                        source: 'Google',
                        email: extractEmail(snippet) || extractEmail(result.title || ''),
                        phone: extractPhone(snippet),
                        address: extractAddress(snippet),
                        url: result.link || undefined,
                    }
                    if (org.name && (org.phone || org.email || org.address)) {
                        found++
                        onProgress(found)
                        yield org
                    }
                }

                if (!data.serpapi_pagination?.next) break

                start += perPage
                await sleep(1000)
            } catch (e: any) {
                log.error(`google.search: ${e.message ?? e}`)
                break
            }
        }
        log.info(`google.search: done found=${found}`)
    }
}
