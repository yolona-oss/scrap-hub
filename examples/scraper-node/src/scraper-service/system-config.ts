import { ConfigRegistry } from '@cmd-hub/core'

/**
 * System-tier scraper config — operator-set, applies to every user on
 * the node. User-tier knobs (AI agent, Google Sheets, request delay
 * preference) live on the per-service `OptionsTree` and arrive merged
 * into `this.data.config` by the framework.
 */
export interface ScraperSystemConfig {
    chromePath?: string
    requestDelayMs?: number
    userAgent?: string
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
    } satisfies ScraperSystemConfig,
})

export async function getScraperSystemConfig(): Promise<ScraperSystemConfig> {
    return ConfigRegistry.get<ScraperSystemConfig>('scraper')
}
