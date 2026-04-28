/* eslint-disable no-console */
import 'reflect-metadata'
import { z } from 'zod'
import { log } from '@cmd-hub/common'
import { MongoStorageMiddleware } from '@cmd-hub/storage-mongo'
import { CmdNodeApp, HubClientMiddleware, InvokeServerMiddleware } from '@cmd-hub/node'

import { OrgScraperService } from './scraper-service/service'
import { registerSources } from './sources'
import { registerExporters } from './exporters'
import { registerCsvExporter } from './plugins/csv'
import { registerGoogleSheetsPlugin } from './plugins/google-sheets'
import { registerBuiltInCheerioSources } from './plugins/cheerio-sources'
import { OrgKind } from './ui-messages/org'
import { SourceFailedKind } from './ui-messages/source-failed'

// Side-effecting plugin registrations. `registerExporters` seeds the
// always-on `json` baseline; `registerCsvExporter` and
// `registerGoogleSheetsPlugin` are opt-in formats. These run before
// any scraper invocation so SourceRegistry / ExporterRegistry are
// populated by the time the manifest emits.
registerSources()
registerExporters()
registerCsvExporter()
registerGoogleSheetsPlugin()
registerBuiltInCheerioSources()

async function bootstrap() {
    const app = new CmdNodeApp({
        configPath: process.argv[2] ?? './config.json',
        baseSchema: z.object({}).passthrough(),
    })
        .use(new MongoStorageMiddleware())
        .use(new InvokeServerMiddleware())
        .use(new HubClientMiddleware())
        // Register the scraper's UiMessage kinds. Same plugin object holds
        // both the build half (used here, on the node) and a default render
        // half (used when a hub running this app loads us as a UI plugin).
        .useUiMessageKind(OrgKind)
        .useUiMessageKind(SourceFailedKind)
        .useCommand(OrgScraperService)

    await app.Initialize()
    log.info('scraper-node ready — initialization complete, parking until SIGINT/SIGTERM')
    await app.run()
    // `run()` parks on a never-resolving promise; the framework's
    // built-in SIGINT/SIGTERM handlers call terminate() on shutdown.
}

bootstrap().catch((e) => {
    console.error('[scraper-node] fatal:', e)
    process.exit(1)
})
