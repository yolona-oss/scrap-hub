/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import express from 'express'
import mongoose from 'mongoose'
// socks-proxy-agent and https-proxy-agent publish via Node 16+ `exports`
// conditional fields that the monorepo's `moduleResolution: "node"` can't
// resolve as ESM imports. Lazy-require them only when the relevant env
// var is set so unused modules aren't loaded at boot.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const requireLocal = require as (id: string) => unknown
import {
    FileService,
    GridFSBackend,
    GrpcCmdNodeClient,
    InMemoryChannelResolver,
    CmdNodeServiceClient,
    makeUploadEndpoint,
    startHubGrpcServer,
    MetricStore,
    CmdNodeRegistry,
    ManifestAggregator,
    SessionIndex,
    HubDispatcher,
    InternalTokenVerifier,
    makeNodeBuiltIn,
    makeHelpBuiltIn,
    makeConfigBuiltIn,
    makeSConfigBuiltIn,
    makeServiceCtrlBuiltIn,
    MongoSystemConfigStore,
    MongoAccountModuleStore,
    NodeRecordModel,
} from '@cmd-hub/core'
import { loadConfig } from './config'
import { TelegramHubUI } from './telegram-hub-ui'

function maybeCreateProxyAgent(socksUrl: string | undefined, httpsUrl: string | undefined): unknown {
    if (socksUrl) {
        const { SocksProxyAgent } = requireLocal('socks-proxy-agent') as {
            SocksProxyAgent: new (url: string) => unknown
        }
        console.log(`[telegram-ui-app] Using SOCKS proxy: ${socksUrl}`)
        return new SocksProxyAgent(socksUrl)
    }
    if (httpsUrl) {
        const { HttpsProxyAgent } = requireLocal('https-proxy-agent') as {
            HttpsProxyAgent: new (url: string) => unknown
        }
        console.log(`[telegram-ui-app] Using HTTPS proxy: ${httpsUrl}`)
        return new HttpsProxyAgent(httpsUrl)
    }
    return undefined
}

async function bootstrap() {
    const cfg = loadConfig()

    // Connect Mongo up-front (needed by the FileService GridFS backend and
    // by built-ins that touch SystemConfig / AccountModule).
    await mongoose.connect(cfg.mongo.url)
    await NodeRecordModel.init()

    // Shared primitives. We build these explicitly rather than letting
    // CmdHubApp auto-wire them because the gRPC server needs references to
    // registry + aggregator + fileService + metrics, and the HubDispatcher
    // needs a GrpcCmdNodeClient wired to a NodeChannelResolver the gRPC
    // server populates via its onNodeRegistered / onNodeDisconnected hooks.
    const tokens = new InternalTokenVerifier()
    const registry = new CmdNodeRegistry({ tokens })
    const aggregator = new ManifestAggregator()
    const sessions = new SessionIndex()
    const metrics = new MetricStore()
    const fileService = new FileService(new GridFSBackend({
        conn: mongoose.connection,
        hubPublicBaseUrl: cfg.hub.publicBaseUrl,
    }))
    const backend = (fileService as unknown as { backend: GridFSBackend }).backend
    const resolver = new InMemoryChannelResolver(
        (addr) => new CmdNodeServiceClient(addr, grpc.credentials.createInsecure()),
    )
    const nodeClient = new GrpcCmdNodeClient(resolver)

    const dispatcher = new HubDispatcher({ aggregator, client: nodeClient })
    dispatcher.registerBuiltIn('node', makeNodeBuiltIn({ registry, aggregator }))
    dispatcher.registerBuiltIn('help', makeHelpBuiltIn({
        aggregator,
        builtInNames: () => dispatcher.builtInNames(),
    }))
    dispatcher.registerBuiltIn('config', makeConfigBuiltIn({
        aggregator,
        store: new MongoSystemConfigStore(),
        configReload: async () => undefined, // Phase-2 RPC wired in a follow-up.
    }))
    dispatcher.registerBuiltIn('sconfig', makeSConfigBuiltIn({
        aggregator,
        store: new MongoAccountModuleStore(),
    }))
    dispatcher.registerBuiltIn('service-ctrl', makeServiceCtrlBuiltIn({ sessions }))

    // HTTP app for the upload endpoint. Runs on a separate port so nodes can
    // PUT bytes against it; gRPC server runs on its own port.
    const httpApp = express()
    httpApp.use(makeUploadEndpoint({
        fileService,
        grantAccess: { peek: (id) => backend.peekGrant(id) },
        conn: mongoose.connection,
    }))
    const httpServer = httpApp.listen(cfg.hub.uploadHttpPort, () => {
        console.log(`[telegram-ui-app] upload endpoint listening on :${cfg.hub.uploadHttpPort}`)
    })

    // gRPC server for nodes to Register / Heartbeat / CreateWriteGrant.
    const hubServer = await startHubGrpcServer({
        bindAddress: cfg.hub.grpcBindAddress,
        credentials: grpc.ServerCredentials.createInsecure(), // Phase-2 mTLS: swap here.
        registry,
        aggregator,
        fileService,
        metrics,
        onNodeRegistered: (nodeId, addr) => {
            console.log(`[telegram-ui-app] node registered: ${nodeId} @ ${addr}`)
            resolver.attach(nodeId, addr)
        },
        onNodeDisconnected: (nodeId) => {
            console.log(`[telegram-ui-app] node disconnected: ${nodeId}`)
            resolver.detach(nodeId)
        },
    })
    console.log(`[telegram-ui-app] gRPC server listening on ${hubServer.boundAddress}`)

    // Compose the CmdHubApp just to carry the telegram UI lifecycle and
    // share our handpicked primitives.
    const telegramUi = new TelegramHubUI({
        botToken: cfg.telegram.botToken,
        httpAgent: maybeCreateProxyAgent(cfg.proxy.socks, cfg.proxy.https),
        adminUserIds: new Set(cfg.telegram.adminUserIds),
    })
    await telegramUi.start({ dispatcher, sessions })

    const shutdown = async (signal: string) => {
        console.log(`[telegram-ui-app] ${signal} received, shutting down`)
        try { await telegramUi.stop() } catch { /* ignore */ }
        try { await hubServer.shutdown() } catch { /* ignore */ }
        await new Promise<void>((resolve) => httpServer.close(() => resolve()))
        resolver.clear()
        await mongoose.disconnect()
        process.exit(0)
    }
    process.on('SIGINT', () => void shutdown('SIGINT'))
    process.on('SIGTERM', () => void shutdown('SIGTERM'))

    console.log('[telegram-ui-app] ready')
}

bootstrap().catch((e) => {
    console.error('[telegram-ui-app] fatal:', e)
    process.exit(1)
})
