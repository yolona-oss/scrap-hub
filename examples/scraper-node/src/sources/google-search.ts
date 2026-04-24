import { IScraperSource } from "./types"
import { OrgData, SearchQuery } from "../types"
import { getScraperConfig } from "../scraper-config"
import log from "@logger"

export class GoogleSearchSource implements IScraperSource {
    readonly name = 'google'
    readonly requiresApiKey = true

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const apiKey = (await getScraperConfig()).serpApiKey
        if (!apiKey) {
            log.warn("scraper.serpApiKey not set in config.json, skipping Google source")
            return
        }

        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        let start = 0
        let found = 0
        const perPage = 10

        while (found < query.maxResults) {
            try {
                const params = new URLSearchParams({
                    api_key: apiKey,
                    engine: 'google',
                    q: searchQuery,
                    start: String(start),
                    num: String(perPage),
                    hl: 'ru',
                    gl: 'ru',
                })

                const res = await fetch(`https://serpapi.com/search.json?${params}`)
                if (!res.ok) {
                    log.error(`SerpAPI error: ${res.status} ${res.statusText}`)
                    break
                }

                const data = await res.json()

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

                // No more results
                if (!data.serpapi_pagination?.next) break

                start += perPage
                await new Promise(r => setTimeout(r, 1000))
            } catch (e: any) {
                log.error(`Google search error: ${e.message ?? e}`)
                break
            }
        }
    }
}

function extractEmail(text: string): string | null {
    const match = text.match(/[\w.+-]+@[\w-]+\.[\w.]+/i)
    return match ? match[0] : null
}

function extractPhone(text: string): string | null {
    const match = text.match(/(?:\+7|8)[\s\-]?\(?\d{3}\)?[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}/)
    return match ? match[0].replace(/[\s\-()]/g, '').replace(/^8/, '+7') : null
}

function extractAddress(text: string): string | null {
    // Basic Russian address pattern: city, street, building
    const match = text.match(/(?:г\.|ул\.|пр\.|пер\.|д\.|стр\.)[\wа-яА-ЯёЁ\s,.\-\/]+/i)
    return match ? match[0].trim() : null
}
