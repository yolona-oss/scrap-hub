/* eslint-disable no-console */
import 'reflect-metadata'
import { z } from 'zod'
import { log } from '@cmd-hub/common'
import { MongoStorageMiddleware } from '@cmd-hub/storage-mongo'
import { CmdNodeApp, HubClientMiddleware, InvokeServerMiddleware } from '@cmd-hub/node'

import { OrgScraperService } from './scraper-service/service'
import { registerSources } from './sources'
import { registerExporters } from './exporters'
import { registerGoogleSheetsPlugin } from './plugins/google-sheets'
import { registerBuiltInCheerioSources } from './plugins/cheerio-sources'

// Side-effecting plugin registrations. These populate SourceRegistry /
// ExporterRegistry before any scraper invocation runs.
registerSources()
registerExporters()
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
