import * as grpc from '@grpc/grpc-js'
import mongoose from 'mongoose'
import { z } from 'zod'
import { IAppMiddleware, ConfigContributor, Phase, AppLike } from '@cmd-hub/common'
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
} from '@cmd-hub/transport'

export interface GrpcServerMiddlewareOptions {
    /** Test-only flag: use ServerCredentials.createInsecure() instead of mTLS. */
    insecure?: boolean
}

/**
 * Starts the hub-side gRPC server and wires the transport-layer primitives
 * onto the Application so later middlewares (UploadEndpointMiddleware,
 * CmdNodeClientMiddleware) and the CmdHubApp can find them.
 *
 * Contributed config:
 *   grpc.bindAddress: string     — e.g. "0.0.0.0:50051" or "127.0.0.1:0" in tests
 *   grpc.publicBaseUrl: string   — used by the upload endpoint to build URLs
 *   tls.caCertPath / serverCertPath / serverKeyPath — required unless `insecure`
 *
 * Stashed on the app instance (TODO(phase-4-later): replace with typed capability registry):
 *   _registry, _aggregator, _fileService, _gridfsBackend, _metrics,
 *   _nodeChannelResolver, _grpcBoundAddress
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
        const cfg = (app.config as { grpc: { bindAddress: string; publicBaseUrl: string } }).grpc
        const tls = (app.config as { tls?: {
            caCertPath?: string
            serverCertPath?: string
            serverKeyPath?: string
        } }).tls

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

        // TODO(phase-4-later): replace `(app as any)._xxx` stashing with a
        // typed capability registry shared by all middlewares.
        ;(app as any)._registry = registry
        ;(app as any)._aggregator = aggregator
        ;(app as any)._fileService = fileService
        ;(app as any)._gridfsBackend = gridfsBackend
        ;(app as any)._metrics = metrics
        ;(app as any)._nodeChannelResolver = resolver
        ;(app as any)._grpcBoundAddress = this._handle.boundAddress
    }

    async uninstall(app: AppLike): Promise<void> {
        if (this._handle) {
            await this._handle.shutdown()
            this._handle = null
        }
        const resolver = (app as any)._nodeChannelResolver as InMemoryChannelResolver | undefined
        if (resolver) {
            try { resolver.clear() } catch { /* ignore */ }
        }
    }
}
