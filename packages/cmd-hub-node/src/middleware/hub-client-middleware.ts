import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import { IAppMiddleware, ConfigContributor, Phase, AppLike } from '@cmd-hub/common'
import { CmdHubProto } from '@cmd-hub/transport'
import { HubClient, IHubServiceClient } from '../runtime/hub-client'
import { MetricsCollector } from '../manifest/metrics-collector'

type NodeManifest = CmdHubProto.NodeManifest

export const HubConfigSchema = z.object({
    address: z.string().min(1),
    token: z.string().min(1),
    nodeId: z.string().min(1),
    nodeName: z.string().min(1),
    version: z.string().min(1),
    certFingerprint: z.string().default(''),
    heartbeatIntervalMs: z.number().int().positive().optional(),
})

export type HubConfig = z.infer<typeof HubConfigSchema>

export interface HubClientMiddlewareOptions {
    /** Test-only: inject a pre-built hub client shim instead of dialing the address. */
    clientOverride?: IHubServiceClient
    /** Override gRPC channel credentials. Defaults to insecure (v1). */
    credentials?: grpc.ChannelCredentials
    /**
     * Test-only: skip Register + Heartbeat. Used by CmdNodeApp unit tests to
     * exercise middleware plumbing without network I/O.
     */
    skipNetwork?: boolean
    /** Test-only: override the MetricsCollector instance. */
    metricsOverride?: MetricsCollector
}

/**
 * Connects the node to its hub during the Services phase: constructs a
 * `HubClient` pointed at `cfg.hub.address`, calls `Register` with the node's
 * manifest, then starts the heartbeat stream.
 *
 * Reads from the app:
 *   _nodeManifest — built by CmdNodeApp from registered services
 *   _invokeBoundAddress — listen address of the node's own InvokeServer (for
 *                         the RegisterRequest.listenAddress field).
 *                         If absent, an empty string is sent and the hub
 *                         cannot dial this node back (useful for tests).
 *
 * Stashes on the app:
 *   _hubClient — the live `HubClient` (null after uninstall)
 *   _metrics   — the MetricsCollector used for heartbeat samples
 */
export class HubClientMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'HubClientMiddleware'
    readonly phase = Phase.Services
    readonly namespace = 'hub'
    readonly schema = HubConfigSchema

    private client: HubClient | null = null
    private metrics: MetricsCollector | null = null

    constructor(private readonly opts: HubClientMiddlewareOptions = {}) {}

    async install(app: AppLike): Promise<void> {
        const cfg = (app.config as { hub: HubConfig }).hub
        const listenAddress = ((app as unknown) as { _invokeBoundAddress?: string })
            ._invokeBoundAddress ?? ''
        const manifest = ((app as unknown) as { _nodeManifest?: NodeManifest })._nodeManifest
        if (!manifest) {
            throw new Error(
                'HubClientMiddleware requires _nodeManifest on the app — ' +
                'CmdNodeApp must build it before install()',
            )
        }

        this.metrics = this.opts.metricsOverride ?? new MetricsCollector()
        this.metrics.start()

        this.client = new HubClient({
            address: cfg.address,
            token: cfg.token,
            nodeId: cfg.nodeId,
            listenAddress,
            certFingerprint: cfg.certFingerprint || undefined,
            heartbeatIntervalMs: cfg.heartbeatIntervalMs,
            credentials: this.opts.credentials,
            client: this.opts.clientOverride,
        })

        ;(app as unknown as { _hubClient: HubClient })._hubClient = this.client
        ;(app as unknown as { _metrics: MetricsCollector })._metrics = this.metrics

        if (this.opts.skipNetwork) return

        await this.client.register(manifest)
        this.client.startHeartbeat(this.metrics)
    }

    async uninstall(app: AppLike): Promise<void> {
        if (this.client) {
            try { await this.client.close() } catch { /* ignore */ }
            this.client = null
        }
        if (this.metrics) {
            try { this.metrics.stop() } catch { /* ignore */ }
            this.metrics = null
        }
        ;(app as unknown as { _hubClient: HubClient | null })._hubClient = null
        ;(app as unknown as { _metrics: MetricsCollector | null })._metrics = null
    }
}
