import { IScraperSource } from "./types"
import { OrgData, SearchQuery } from "../types"
import { getScraperConfig } from "../scraper-config"
import * as cheerio from "cheerio"
import axios from "axios"
import { log } from "@cmd-hub/common"

export class YandexSearchSource implements IScraperSource {
    readonly name = 'yandex'
    readonly requiresApiKey = true

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const cfg = await getScraperConfig()
        const user = cfg.yandexXmlUser
        const key = cfg.yandexXmlKey

        if (!user || !key) {
            log.warn("scraper.yandexXmlUser or scraper.yandexXmlKey not set in config.json, skipping Yandex source")
            return
        }

        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        let page = 0
        let found = 0

        while (found < query.maxResults) {
            try {
                const params = new URLSearchParams({
                    user,
                    key,
                    query: searchQuery,
                    page: String(page),
                    groupby: 'attr=d.mode=deep.groups-on-page=10.docs-in-group=1',
                    l10n: 'ru',
                })

                const res = await axios.get(`https://yandex.com/search/xml?${params}`, {
                    timeout: 15000,
                    headers: { 'Accept': 'application/xml' }
                })

                const $ = cheerio.load(res.data, { xmlMode: true })
                const groups = $('group')

                if (groups.length === 0) break

                for (let i = 0; i < groups.length; i++) {
                    const group = groups.eq(i)
                    const doc = group.find('doc').first()
                    const url = doc.find('url').text()
                    const title = doc.find('title').text().replace(/<[^>]*>/g, '')
                    const passage = doc.find('passages passage').text()

                    const org: OrgData = {
                        name: title || '',
                        source: 'Yandex',
                        email: extractEmail(passage) || extractEmail(title),
                        phone: extractPhone(passage),
                        address: extractAddress(passage),
                        url: url || undefined,
                    }

                    if (org.name && (org.phone || org.email || org.address)) {
                        found++
                        onProgress(found)
                        yield org
                    }
                }

                page++
                await new Promise(r => setTimeout(r, 1500))
            } catch (e: any) {
                log.error(`Yandex search error: ${e.message ?? e}`)
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
    const match = text.match(/(?:г\.|ул\.|пр\.|пер\.|д\.|стр\.)[\wа-яА-ЯёЁ\s,.\-\/]+/i)
    return match ? match[0].trim() : null
}
