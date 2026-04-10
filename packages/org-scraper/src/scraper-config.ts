import { ConfigRegistry } from '@core/config-registry'

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
}

export async function getScraperConfig(): Promise<IScraperConfig> {
    return ConfigRegistry.get<IScraperConfig>('scraper')
}
