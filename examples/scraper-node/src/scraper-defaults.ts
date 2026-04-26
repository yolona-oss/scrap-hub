/** Per-user defaults for AI-agent and Google Sheets settings.
 *
 *  Both blocks are intentionally NOT registered with `ConfigRegistry` —
 *  they live exclusively as per-user config in the account/session
 *  layered store. These constants provide the fallback when the user
 *  hasn't (yet) set anything via `/sconfig` or the hierarchical builder. */

/** Locale used across the scraper for HTTP `Accept-Language` headers and
 *  provider-specific `lang/hl/gl/l10n` parameters. Hardcoded for now —
 *  promote to a config field if the scraper needs to support more locales. */
export const SCRAPER_LANGUAGE = 'ru' as const
export const SCRAPER_ACCEPT_LANGUAGE = 'ru-RU,ru;q=0.9' as const

export interface IAIAgentConfig {
    baseUrl?: string
    apiKey?: string
    model?: string
    temperature?: number
    webSearchProvider?: 'serpapi' | 'yandex' | 'duckduckgo'
    maxToolCalls?: number
    toolTimeoutMs?: number
    totalTimeoutMs?: number
}

export const AI_AGENT_DEFAULTS: Required<IAIAgentConfig> = {
    baseUrl: 'http://127.0.0.1:11434/v1',
    apiKey: '',
    model: 'qwen2.5:7b',
    temperature: 0.2,
    webSearchProvider: 'duckduckgo',
    maxToolCalls: 25,
    toolTimeoutMs: 60_000,
    totalTimeoutMs: 300_000,
}

export interface IGoogleSheetsConfig {
    credentials?: string | Record<string, any>
    spreadsheetId?: string
}

export const GOOGLE_SHEETS_DEFAULTS: Required<IGoogleSheetsConfig> = {
    credentials: '',
    spreadsheetId: '',
}
