import { BaseUIContext } from '@core/ui'
import { ICmdRegisterManyEntry } from '@core/ui/command-processor'
import { ConfigRegistry } from '@core/config-registry'
import { registerSources } from './sources'
import { registerExporters } from './exporters'
import { registerGoogleSheetsPlugin } from './plugins/google-sheets'
import { registerBuiltInCheerioSources } from './plugins/cheerio-sources'
import { initializeCommands } from './commands'

export { OrgScraperService, SCRAPER_NAME, SCRAPER_DESCRIPTION } from './scraper-service/service'
export { SourceRegistry } from './sources'
export { ExporterRegistry } from './exporters'
export { registerCheerioSource, CheerioWebSource } from './plugins/cheerio-sources'
export type { CheerioSourceConfig } from './plugins/cheerio-sources'

export function register() {
    ConfigRegistry.register({
        name: 'scraper',
        scope: 'system',
        defaults: {
            serpApiKey: '',
            yandexXmlUser: '',
            yandexXmlKey: '',
            chromePath: '',
            requestDelayMs: 1000,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            googleSheets: {
                credentials: '',
                spreadsheetId: ''
            }
        },
        sensitive: ['serpApiKey', 'yandexXmlKey', 'credentials']
    })

    registerSources()
    registerExporters()
    registerGoogleSheetsPlugin()
    registerBuiltInCheerioSources()
}

export function commands<Ctx extends BaseUIContext>(): ICmdRegisterManyEntry<Ctx> {
    return initializeCommands<Ctx>()
}
