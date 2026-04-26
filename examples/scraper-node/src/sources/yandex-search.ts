import { IScraperSource, SourceAvailability } from "./types"
import { OrgData, SearchQuery } from "../types"
import { getScraperConfig } from "../scraper-config"
import { SCRAPER_LANGUAGE } from "../scraper-defaults"
import { extractEmail, extractPhone, extractAddress } from "./extract"
import { httpGet } from "./http"
import * as cheerio from "cheerio"
import { log, sleep } from "@cmd-hub/common"

export class YandexSearchSource implements IScraperSource {
    async availability(): Promise<SourceAvailability> {
        const cfg = await getScraperConfig()
        if (!cfg.yandexXmlUser || !cfg.yandexXmlKey) {
            return { ok: false, reason: 'scraper.yandexXmlUser / yandexXmlKey not configured' }
        }
        return { ok: true }
    }

    async* search(query: SearchQuery, onProgress: (found: number) => void): AsyncGenerator<OrgData> {
        const cfg = await getScraperConfig()
        const user = cfg.yandexXmlUser
        const key = cfg.yandexXmlKey
        if (!user || !key) {
            throw new Error('scraper.yandexXmlUser / yandexXmlKey not configured')
        }

        const searchQuery = query.city
            ? `${query.query} ${query.city}`
            : query.query

        log.info(`yandex.search: query="${searchQuery}" maxResults=${query.maxResults}`)
        let page = 0
        let found = 0

        while (found < query.maxResults) {
            log.trace(`yandex.search: page=${page} found=${found}`)
            try {
                const params = new URLSearchParams({
                    user,
                    key,
                    query: searchQuery,
                    page: String(page),
                    groupby: 'attr=d.mode=deep.groups-on-page=10.docs-in-group=1',
                    l10n: SCRAPER_LANGUAGE,
                })

                const res = await httpGet(`https://yandex.com/search/xml?${params}`, {
                    headers: { 'Accept': 'application/xml' },
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
                await sleep(1500)
            } catch (e: any) {
                log.error(`yandex.search: ${e.message ?? e}`)
                break
            }
        }
        log.info(`yandex.search: done found=${found}`)
    }
}
