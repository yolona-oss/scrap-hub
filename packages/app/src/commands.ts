import { BaseUIContext } from "@core/ui"
import { ICmdRegisterManyEntry } from "@core/ui/command-processor"

// Plugins
import * as orgScraper from 'org-scraper'

export function initializePlugins() {
    orgScraper.register()

    // Register custom cheerio-based scraper sources
    orgScraper.registerCheerioSource({
        name: '2gis',
        urlTemplate: 'https://2gis.ru/search/{query}/page/{page}',
        itemSelector: '._1hf7139',
        selectors: {
            name: '._1al2wlf',
            phone: '._b0ke8',
            address: '._14quei',
            url: '._1rehek a',
        },
        extractMode: { url: 'href' },
        maxPages: 5,
    })
}

export function initializeCommands<Ctx extends BaseUIContext>(): ICmdRegisterManyEntry<Ctx> {
    return [
        // org-scraper commands
        ...orgScraper.commands<Ctx>(),
    ]
}
