import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import {
    IAppMiddleware,
    ConfigContributor,
    Phase,
    AppLike,
    readConfigSlice,
} from '@cmd-hub/common'
import { HubClient, IHubServiceClient } from '../runtime/hub-client'
import { MetricsCollector } from '../manifest/metrics-collector'
import {
    CAP_NodeManifest,
    CAP_NodeInvokeBoundAddress,
    CAP_NodeHubClient,
    CAP_NodeMetricsCollector,
} from '../capabilities'

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
 * Required capabilities:
 *   CAP_NodeManifest — built by CmdNodeApp from registered services.
 *
 * Optional capabilities (listen address is '' if absent — useful in tests):
 *   CAP_NodeInvokeBoundAddress — populated by InvokeServerMiddleware.
 *
 * Published capabilities:
 *   CAP_NodeHubClient — the live `HubClient`.
 *   CAP_NodeMetricsCollector — MetricsCollector feeding the heartbeat stream.
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
        const cfg = readConfigSlice(app, this)
        const listenAddress = app.get(CAP_NodeInvokeBoundAddress) ?? ''
        const manifest = app.get(CAP_NodeManifest)
        if (!manifest) {
            throw new Error(
                'HubClientMiddleware requires CAP_NodeManifest — ' +
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

        app.provide(CAP_NodeHubClient, this.client)
        app.provide(CAP_NodeMetricsCollector, this.metrics)

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
        app.revoke(CAP_NodeHubClient)
        app.revoke(CAP_NodeMetricsCollector)
    }
}
