import { ConfigRegistry } from '@cmd-hub/core'

export const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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

export interface IScraperConfig {
    serpApiKey?: string
    yandexXmlUser?: string
    yandexXmlKey?: string
    chromePath?: string
    requestDelayMs?: number
    userAgent?: string
    googleSheets?: {
        credentials?: string | Record<string, any>
        spreadsheetId?: string
    }
    aiAgent?: IAIAgentConfig
}

ConfigRegistry.register({
    name: 'scraper',
    scope: 'system',
    sensitive: ['serpApiKey', 'yandexXmlKey', 'apiKey', 'credentials'],
    defaults: {
        serpApiKey: '',
        yandexXmlUser: '',
        yandexXmlKey: '',
        chromePath: '',
        requestDelayMs: 1000,
        userAgent: DEFAULT_USER_AGENT,
        googleSheets: { credentials: '', spreadsheetId: '' },
        aiAgent: {
            baseUrl: 'http://127.0.0.1:11434/v1',
            apiKey: '',
            model: 'qwen2.5:7b',
            temperature: 0.2,
            webSearchProvider: 'duckduckgo',
            maxToolCalls: 25,
            toolTimeoutMs: 60_000,
            totalTimeoutMs: 300_000,
        },
    } satisfies IScraperConfig,
})

export async function getScraperConfig(): Promise<IScraperConfig> {
    return ConfigRegistry.get<IScraperConfig>('scraper')
}
