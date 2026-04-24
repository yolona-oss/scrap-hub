import { ConfigRegistry } from '@core/config-registry'

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

export async function getScraperConfig(): Promise<IScraperConfig> {
    return ConfigRegistry.get<IScraperConfig>('scraper')
}
