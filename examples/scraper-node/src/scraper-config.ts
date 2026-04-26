import { ConfigRegistry } from '@cmd-hub/core'
import {
    AI_AGENT_DEFAULTS,
    GOOGLE_SHEETS_DEFAULTS,
    IAIAgentConfig,
    IGoogleSheetsConfig,
} from './scraper-defaults'

export const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/** System-wide scraper config — operator credentials and global rate
 *  limits. `aiAgent` and `googleSheets` are NOT here; they live only in
 *  per-user account/session storage with `scraper-defaults.ts` as
 *  fallback. See `resolveScraperUserConfig` for the merged read. */
export interface IScraperConfig {
    serpApiKey?: string
    yandexXmlUser?: string
    yandexXmlKey?: string
    chromePath?: string
    requestDelayMs?: number
    userAgent?: string
}

ConfigRegistry.register({
    name: 'scraper',
    scope: 'system',
    sensitive: ['serpApiKey', 'yandexXmlKey'],
    defaults: {
        serpApiKey: '',
        yandexXmlUser: '',
        yandexXmlKey: '',
        chromePath: '',
        requestDelayMs: 1000,
        userAgent: DEFAULT_USER_AGENT,
    } satisfies IScraperConfig,
})

export async function getScraperConfig(): Promise<IScraperConfig> {
    return ConfigRegistry.get<IScraperConfig>('scraper')
}

export interface ResolvedScraperUserConfig {
    aiAgent: Required<IAIAgentConfig>
    googleSheets: Required<IGoogleSheetsConfig>
    requestDelayMs: number
}

/**
 * Merge per-user config (from `ServiceContext.config`, populated by the
 * scraper's account-module + session-layer store) over the constant
 * defaults in `scraper-defaults.ts`. Every nested key has a default so
 * a fresh user doesn't crash.
 *
 * `sys` is optional — pass it in when the caller already has it to
 * avoid a redundant `ConfigRegistry.get('scraper')` round trip for
 * `requestDelayMs` (the only system-tier slice this resolver consults).
 */
export async function resolveScraperUserConfig(
    context?: { config?: Record<string, any> },
    sys?: IScraperConfig,
): Promise<ResolvedScraperUserConfig> {
    sys ??= await getScraperConfig()
    const user = (context?.config ?? {}) as { aiAgent?: IAIAgentConfig; googleSheets?: IGoogleSheetsConfig; requestDelayMs?: number | string }

    const userAi: IAIAgentConfig = user.aiAgent ?? {}
    const aiAgent: Required<IAIAgentConfig> = {
        baseUrl: userAi.baseUrl ?? AI_AGENT_DEFAULTS.baseUrl,
        apiKey: userAi.apiKey ?? AI_AGENT_DEFAULTS.apiKey,
        model: userAi.model ?? AI_AGENT_DEFAULTS.model,
        temperature: userAi.temperature ?? AI_AGENT_DEFAULTS.temperature,
        webSearchProvider: userAi.webSearchProvider ?? AI_AGENT_DEFAULTS.webSearchProvider,
        maxToolCalls: userAi.maxToolCalls ?? AI_AGENT_DEFAULTS.maxToolCalls,
        toolTimeoutMs: userAi.toolTimeoutMs ?? AI_AGENT_DEFAULTS.toolTimeoutMs,
        totalTimeoutMs: userAi.totalTimeoutMs ?? AI_AGENT_DEFAULTS.totalTimeoutMs,
    }

    const userGs: IGoogleSheetsConfig = user.googleSheets ?? {}
    const googleSheets: Required<IGoogleSheetsConfig> = {
        credentials: userGs.credentials ?? GOOGLE_SHEETS_DEFAULTS.credentials,
        spreadsheetId: userGs.spreadsheetId ?? GOOGLE_SHEETS_DEFAULTS.spreadsheetId,
    }

    // user.requestDelayMs may arrive as a string (the builder commits
    // pair-option leaves as strings); coerce to number, fall back to system.
    const userDelay = Number(user.requestDelayMs)
    const requestDelayMs = Number.isFinite(userDelay) ? userDelay : (sys.requestDelayMs ?? 1000)

    return { aiAgent, googleSheets, requestDelayMs }
}
