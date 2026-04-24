/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import mongoose from 'mongoose'
import { ConfigRegistry } from '@core/config-registry'
import { CmdNodeApp } from 'cmd-node/src/app/cmd-node-app'
import { MetricsCollector } from 'cmd-node/src/manifest/metrics-collector'
import { HubClient } from 'cmd-node/src/runtime/hub-client'
import {
    startNodeGrpcServer,
    makeInvokeServerImpl,
    type InvokeExecutor,
} from 'cmd-node/src/runtime/invoke-server'
import { loadNodeConfig } from './node-config'
import { registerSources, SourceRegistry } from './sources'
import { registerExporters } from './exporters'
import { registerGoogleSheetsPlugin } from './plugins/google-sheets'
import { registerBuiltInCheerioSources } from './plugins/cheerio-sources'
import {
    OrgScraperService,
    SCRAPER_NAME,
    SCRAPER_DESCRIPTION,
} from './scraper-service/service'
import { buildScraperExecutor } from './invoke-bridge'

async function bootstrap() {
    const cfg = loadNodeConfig()

    // Register the scraper's ConfigRegistry module — the manifest we publish
    // to the hub carries this schema so /config can list + edit the module
    // from any UI.
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
            googleSheets: { credentials: '', spreadsheetId: '' },
        },
        sensitive: ['serpApiKey', 'yandexXmlKey', 'credentials'],
    })
    registerSources()
    registerExporters()
    registerGoogleSheetsPlugin()
    registerBuiltInCheerioSources()

    await mongoose.connect(cfg.mongoUrl)

    const nodeApp = new CmdNodeApp({
        nodeId: cfg.nodeId,
        nodeName: cfg.nodeName,
        version: '1.0.0',
        hubAddress: cfg.hubAddress,
        mongoUrl: cfg.mongoUrl,
    })

    nodeApp.useConfigModule({
        name: 'scraper',
        scope: 'system',
        fields: [
            { name: 'serpApiKey',    type: 'string', sensitive: true,  description: 'SerpAPI key',         defaultValue: '' },
            { name: 'yandexXmlUser', type: 'string', sensitive: false, description: 'Yandex XML user',     defaultValue: '' },
            { name: 'yandexXmlKey',  type: 'string', sensitive: true,  description: 'Yandex XML API key',  defaultValue: '' },
            { name: 'chromePath',    type: 'string', sensitive: false, description: 'Puppeteer chrome bin', defaultValue: '' },
        ],
    })

    nodeApp.useCommand({
        name: SCRAPER_NAME,
        compatibilityId: 'com.example.scrap-hub.scraper',
        version: '1.0.0',
        description: SCRAPER_DESCRIPTION,
        args: [
            { name: 'query',   position: 1, required: true,  type: 'string', description: 'Search query',              enumValues: [], defaultValue: '' },
            { name: 'city',    position: 2, required: false, type: 'string', description: 'City / region filter',      enumValues: [], defaultValue: '' },
            { name: 'limit',   position: 3, required: false, type: 'string', description: 'Max rows (default 100000)', enumValues: [], defaultValue: '100000' },
            { name: 'format',  position: 4, required: false, type: 'enum',   description: 'Export format',             enumValues: ['csv'], defaultValue: 'csv' },
            { name: 'sources', position: 5, required: false, type: 'string', description: 'Comma-separated sources or "all"', enumValues: [], defaultValue: 'all' },
        ],
        aliases: [],
    })

    const executor: InvokeExecutor = buildScraperExecutor({
        makeService: (userId, data) => new OrgScraperService(userId, data),
        availableSources: () => SourceRegistry.available(),
    })

    const nodeServer = await startNodeGrpcServer({
        bindAddress: cfg.listenBindAddress,
        credentials: grpc.ServerCredentials.createInsecure(), // mTLS: Phase 2.4 hooks.
        impl: makeInvokeServerImpl({ executor }),
    })
    console.log(`[scraper-node] Invoke server listening on ${nodeServer.boundAddress}`)

    const hubClient = new HubClient({
        hubAddress: cfg.hubAddress,
        nodeId: cfg.nodeId,
        token: cfg.nodeToken,
        listenAddress: nodeServer.boundAddress,
        certFingerprint: cfg.certFingerprint,
        credentials: grpc.credentials.createInsecure(),
        heartbeatIntervalMs: 15_000,
    })

    const manifest = nodeApp.buildManifest()
    const regRes = await hubClient.register(manifest)
    console.log(`[scraper-node] registered: pollInterval=${regRes.pollIntervalMs}ms state=${regRes.assignedState}`)

    const metrics = new MetricsCollector({ lagSampleEveryMs: 1000 })
    metrics.start()
    hubClient.startHeartbeat(metrics)

    await nodeApp.start()

    const shutdown = async (signal: string) => {
        console.log(`[scraper-node] ${signal} received, shutting down`)
        metrics.stop()
        try { hubClient.stop() } catch { /* ignore */ }
        try { await nodeServer.shutdown() } catch { /* ignore */ }
        try { await nodeApp.stop() } catch { /* ignore */ }
        await mongoose.disconnect()
        process.exit(0)
    }
    process.on('SIGINT',  () => void shutdown('SIGINT'))
    process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

bootstrap().catch((e) => {
    console.error('[scraper-node] fatal:', e)
    process.exit(1)
})
