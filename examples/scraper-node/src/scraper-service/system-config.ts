import { ConfigRegistry } from '@cmd-hub/core'
import { log } from '@cmd-hub/common'

/**
 * System-tier scraper config — operator-set, applies to every user on
 * the node. User-tier knobs (AI agent, Google Sheets, request delay
 * preference) live on the per-service `ArgTree` and arrive merged
 * into `this.data.args` by the framework.
 */
export interface ScraperSystemConfig {
    chromePath?: string
    requestDelayMs?: number
    userAgent?: string
    /** Self-hosted SearXNG base URL (e.g. `http://127.0.0.1:8080`) used by
     *  the AI agent's `web_search` tool. SearXNG must have JSON output enabled
     *  in `settings.yml` (`search.formats: [html, json]`) and the rate limiter
     *  disabled for unattended scraping. Empty string → web_search disabled. */
    searxngUrl?: string
}

export const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** Locale used across the scraper for HTTP `Accept-Language` headers and
 *  provider-specific `lang/hl/gl/l10n` parameters. Hardcoded for now —
 *  promote to a config field if the scraper needs to support more locales. */
export const SCRAPER_LANGUAGE = 'ru' as const

/** ISO 3166-1 alpha-2 country code paired with `SCRAPER_LANGUAGE`. */
export const SCRAPER_COUNTRY = 'RU' as const

/** BCP-47 Accept-Language with primary tag + bare-language fallback. */
export const SCRAPER_ACCEPT_LANGUAGE =
    `${SCRAPER_LANGUAGE}-${SCRAPER_COUNTRY},${SCRAPER_LANGUAGE};q=0.9` as const

ConfigRegistry.register({
    name: 'scraper',
    scope: 'system',
    defaults: {
        chromePath: '',
        requestDelayMs: 1000,
        userAgent: DEFAULT_USER_AGENT,
        searxngUrl: '',
    } satisfies ScraperSystemConfig,
})

export async function getScraperSystemConfig(): Promise<ScraperSystemConfig> {
    const cfg = await ConfigRegistry.get<ScraperSystemConfig>('scraper')
    log.trace(`scraper-service.getScraperSystemConfig: requestDelayMs=${cfg.requestDelayMs} userAgent=${cfg.userAgent ? 'set' : 'empty'} searxngUrl=${cfg.searxngUrl ? 'set' : 'empty'}`)
    return cfg
}
