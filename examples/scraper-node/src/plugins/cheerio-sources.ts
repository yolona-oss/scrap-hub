import { SourceRegistry } from "../sources/registry"
import { CheerioWebSource, CheerioSourceConfig } from "../sources/cheerio-web"
import { log } from "@cmd-hub/common"

export { CheerioWebSource } from "../sources/cheerio-web"
export type { CheerioSourceConfig } from "../sources/cheerio-web"

/**
 * Register a custom cheerio-based source as a plugin.
 *
 * Example:
 *   registerCheerioSource({
 *       name: '2gis',
 *       urlTemplate: 'https://2gis.ru/search/{query}?page={page}',
 *       itemSelector: '.orgCard',
 *       selectors: {
 *           name: '.orgCard__title',
 *           phone: '.orgCard__phone',
 *           address: '.orgCard__address',
 *           url: '.orgCard__title a',
 *       },
 *       extractMode: { url: 'href' },
 *   })
 */
export function registerCheerioSource(config: CheerioSourceConfig): void {
    log.debug(`cheerio-sources.registerCheerioSource: name="${config.name}" template="${config.urlTemplate}" maxPages=${config.maxPages ?? 1}`)
    SourceRegistry.register(config.name, () => new CheerioWebSource(config))
}

/**
 * Built-in cheerio source configs for common Russian business directories
 */
export function registerBuiltInCheerioSources(): void {
    log.info('cheerio-sources.registerBuiltInCheerioSources: registering built-in cheerio sources (yandex-html, zoon, flamp)')
    // Yandex search (HTML scraping fallback — no API key needed)
    registerCheerioSource({
        name: 'yandex-html',
        urlTemplate: 'https://yandex.ru/search/?text={query}&p={page}',
        itemSelector: '.serp-item',
        selectors: {
            name: '.OrganicTitle-LinkText',
            url: '.OrganicTitle-Link',
            address: '.Path',
        },
        extractMode: { url: 'href' },
        maxPages: 5,
        delayMs: 2000,
    })

    // Zoon.ru — business directory
    registerCheerioSource({
        name: 'zoon',
        urlTemplate: 'https://zoon.ru/search/?search_query={query}&page={page}',
        itemSelector: '.minicard-item',
        selectors: {
            name: '.minicard-item__title',
            phone: '.minicard-item__phone',
            address: '.minicard-item__address',
            url: '.minicard-item__title a',
        },
        extractMode: { url: 'href' },
        maxPages: 10,
        delayMs: 1500,
    })

    // Flamp.ru — reviews and business listings
    registerCheerioSource({
        name: 'flamp',
        urlTemplate: 'https://flamp.ru/search/{query}?page={page}',
        itemSelector: '.search-result-item',
        selectors: {
            name: '.search-result-item__title',
            address: '.search-result-item__address',
            url: '.search-result-item__title a',
        },
        extractMode: { url: 'href' },
        maxPages: 5,
        delayMs: 2000,
    })
}
