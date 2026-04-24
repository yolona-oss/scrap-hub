import * as grpc from '@grpc/grpc-js'
import mongoose from 'mongoose'
import { z } from 'zod'
import {
    IAppMiddleware,
    ConfigContributor,
    Phase,
    AppLike,
    readConfigSlice,
} from '@cmd-hub/common'
import {
    startHubGrpcServer,
    type HubGrpcServerHandle,
    CmdNodeRegistry,
    ManifestAggregator,
    FileService,
    GridFSBackend,
    MetricStore,
    InternalTokenVerifier,
    InMemoryChannelResolver,
    hubServerCredentialsFromPaths,
    mTlsFingerprintResolver,
    CmdHubProto,
    CAP_CmdNodeRegistry,
    CAP_ManifestAggregator,
    CAP_FileService,
    CAP_GridFSBackend,
    CAP_MetricStore,
    CAP_NodeChannelResolver,
    CAP_GrpcBoundAddress,
} from '@cmd-hub/transport'

export interface GrpcServerMiddlewareOptions {
    /** Test-only flag: use ServerCredentials.createInsecure() instead of mTLS. */
    insecure?: boolean
}

/** Optional `tls` config slice — consumed by GrpcServerMiddleware when
 *  `insecure` is not set. Kept as a named interface so downstream
 *  apps can embed it in their own zod schema. */
interface TlsConfigSlice {
    tls?: {
        caCertPath?: string
        serverCertPath?: string
        serverKeyPath?: string
    }
}

/**
 * Starts the hub-side gRPC server and publishes the transport-layer
 * primitives via the typed capability registry so later middlewares
 * (UploadEndpointMiddleware, CmdNodeClientMiddleware) and the CmdHubApp
 * can find them.
 *
 * Contributed config:
 *   grpc.bindAddress: string     — e.g. "0.0.0.0:50051" or "127.0.0.1:0" in tests
 *   grpc.publicBaseUrl: string   — used by the upload endpoint to build URLs
 *   tls.caCertPath / serverCertPath / serverKeyPath — required unless `insecure`
 *
 * Published capabilities (see @cmd-hub/transport/capabilities):
 *   CAP_CmdNodeRegistry, CAP_ManifestAggregator, CAP_FileService,
 *   CAP_GridFSBackend, CAP_MetricStore, CAP_NodeChannelResolver,
 *   CAP_GrpcBoundAddress.
 */
export class GrpcServerMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'GrpcServerMiddleware'
    readonly phase = Phase.Transport
    readonly namespace = 'grpc'
    readonly schema = z.object({
        bindAddress: z.string().min(1),
        publicBaseUrl: z.string().min(1),
    })

    private _handle: HubGrpcServerHandle | null = null

    constructor(private readonly opts: GrpcServerMiddlewareOptions = {}) {}

    async install(app: AppLike): Promise<void> {
        const cfg = readConfigSlice(app, this)
        const tls = (app.config as TlsConfigSlice | null)?.tls

        const registry = new CmdNodeRegistry({ tokens: new InternalTokenVerifier() })
        const aggregator = new ManifestAggregator()
        const metrics = new MetricStore()
        const gridfsBackend = new GridFSBackend({
            conn: mongoose.connection,
            hubPublicBaseUrl: cfg.publicBaseUrl,
        })
        const fileService = new FileService(gridfsBackend)
        const resolver = new InMemoryChannelResolver(
            (addr) => new CmdHubProto.CmdNodeServiceClient(addr, grpc.credentials.createInsecure()),
        )

        const credentials = this.opts.insecure
            ? grpc.ServerCredentials.createInsecure()
            : hubServerCredentialsFromPaths({
                caCertPath: tls?.caCertPath ?? '',
                hubCertPath: tls?.serverCertPath ?? '',
                hubKeyPath: tls?.serverKeyPath ?? '',
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
            onNodeDisconnected: (nodeId) => resolver.detach(nodeId),
        })

        app.provide(CAP_CmdNodeRegistry, registry)
        app.provide(CAP_ManifestAggregator, aggregator)
        app.provide(CAP_FileService, fileService)
        app.provide(CAP_GridFSBackend, gridfsBackend)
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
        app.revoke(CAP_GridFSBackend)
        app.revoke(CAP_MetricStore)
        app.revoke(CAP_NodeChannelResolver)
        app.revoke(CAP_GrpcBoundAddress)
    }
}
