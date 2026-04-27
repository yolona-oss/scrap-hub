import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import {
    IAppMiddleware,
    ConfigContributor,
    Phase,
    AppLike,
    readConfigSlice,
    requireCap,
    log,
    CAP_FileBackend,
    CAP_NodeRecordRepo,
} from '@cmd-hub/common'
import {
    startHubGrpcServer,
    type HubGrpcServerHandle,
    CmdNodeRegistry,
    ManifestAggregator,
    FileService,
    MetricStore,
    InternalTokenVerifier,
    InMemoryChannelResolver,
    hubServerCredentialsFromPaths,
    mTlsFingerprintResolver,
    CmdHubProto,
    CAP_CmdNodeRegistry,
    CAP_ManifestAggregator,
    CAP_FileService,
    CAP_MetricStore,
    CAP_NodeChannelResolver,
    CAP_GrpcBoundAddress,
} from '@cmd-hub/transport'

export interface GrpcServerMiddlewareOptions {
    /** Test-only flag: use ServerCredentials.createInsecure() instead of mTLS. */
    insecure?: boolean
}

/** Hub-side gRPC server. Reads `grpc.{bindAddress,tls.*}`; TLS paths are
 *  required unless `opts.insecure` is set. */
export class GrpcServerMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'GrpcServerMiddleware'
    readonly phase = Phase.Transport
    readonly namespace = 'grpc'
    readonly schema = z.object({
        bindAddress: z.string().min(1),
        tls: z.object({
            caCertPath: z.string().default(''),
            serverCertPath: z.string().default(''),
            serverKeyPath: z.string().default(''),
        }).default({}),
    })

    private _handle: HubGrpcServerHandle | null = null

    constructor(private readonly opts: GrpcServerMiddlewareOptions = {}) {}

    async install(app: AppLike): Promise<void> {
        const cfg = readConfigSlice(app, this)

        const fileBackend = requireCap(
            app, CAP_FileBackend,
            'GrpcServerMiddleware needs a file-backend middleware that provides CAP_FileBackend before it',
        )
        const nodeRepo = requireCap(
            app, CAP_NodeRecordRepo,
            'GrpcServerMiddleware needs a storage middleware that provides CAP_NodeRecordRepo before it',
        )

        const registry = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(), repo: nodeRepo })
        const aggregator = new ManifestAggregator()
        const metrics = new MetricStore()
        const fileService = new FileService(fileBackend)
        const resolver = new InMemoryChannelResolver(
            (addr) => new CmdHubProto.CmdNodeServiceClient(addr, grpc.credentials.createInsecure()),
        )

        const credentials = this.opts.insecure
            ? grpc.ServerCredentials.createInsecure()
            : hubServerCredentialsFromPaths({
                caCertPath: cfg.tls.caCertPath,
                hubCertPath: cfg.tls.serverCertPath,
                hubKeyPath: cfg.tls.serverKeyPath,
            })
        const fpResolver = this.opts.insecure ? undefined : mTlsFingerprintResolver()

        this._handle = await startHubGrpcServer({
            bindAddress: cfg.bindAddress,
            credentials,
            registry,
            aggregator,
            fileService,
            metrics,
            resolveFingerprint: fpResolver,
            onNodeRegistered: (nodeId, addr) => resolver.attach(nodeId, addr),
            onNodeDisconnected: (nodeId) => {
                // Detach BOTH so a reconnect doesn't hit "already attached"
                // and get the node demoted to DISABLED.
                resolver.detach(nodeId)
                aggregator.detach(nodeId)
            },
        })

        log.info(`GrpcServerMiddleware: hub gRPC bound at ${this._handle.boundAddress} (insecure=${!!this.opts.insecure})`)
        app.provide(CAP_CmdNodeRegistry, registry)
        app.provide(CAP_ManifestAggregator, aggregator)
        app.provide(CAP_FileService, fileService)
        app.provide(CAP_MetricStore, metrics)
        app.provide(CAP_NodeChannelResolver, resolver)
        app.provide(CAP_GrpcBoundAddress, this._handle.boundAddress)
    }

    async uninstall(app: AppLike): Promise<void> {
        if (this._handle) {
            await this._handle.shutdown()
            this._handle = null
        }
        const resolver = app.get(CAP_NodeChannelResolver)
        if (resolver) {
            try { resolver.clear() } catch { /* ignore */ }
        }
        app.revoke(CAP_CmdNodeRegistry)
        app.revoke(CAP_ManifestAggregator)
        app.revoke(CAP_FileService)
        app.revoke(CAP_MetricStore)
        app.revoke(CAP_NodeChannelResolver)
        app.revoke(CAP_GrpcBoundAddress)
    }
}
