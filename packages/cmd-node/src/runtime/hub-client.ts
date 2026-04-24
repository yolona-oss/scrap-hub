import * as grpc from '@grpc/grpc-js'
import {
    CmdHubServiceClient,
    type NodeManifest,
    type RegisterResponse,
    type HeartbeatClient,
    type HeartbeatServer,
} from '@core/grpc/generated/cmd_node'
import type { MetricsCollector } from '../manifest/metrics-collector'

export interface HubClientOptions {
    hubAddress: string
    nodeId: string
    token: string
    listenAddress: string
    /** Fingerprint the hub expects for this node (v2: comes from the mTLS stack). */
    certFingerprint: string
    credentials: grpc.ChannelCredentials
    heartbeatIntervalMs?: number
}

export class HubClient {
    private readonly stub: CmdHubServiceClient
    private heartbeat: grpc.ClientDuplexStream<HeartbeatClient, HeartbeatServer> | null = null
    private heartbeatTimer: NodeJS.Timeout | null = null
    private stopped = false

    constructor(private readonly opts: HubClientOptions) {
        this.stub = new CmdHubServiceClient(opts.hubAddress, opts.credentials)
    }

    register(manifest: NodeManifest): Promise<RegisterResponse> {
        const md = new grpc.Metadata()
        md.set('x-cmdhub-node-fingerprint', this.opts.certFingerprint)
        return new Promise((resolve, reject) => {
            this.stub.register(
                {
                    nodeId: this.opts.nodeId,
                    token: this.opts.token,
                    listenAddress: this.opts.listenAddress,
                    manifest,
                },
                md,
                (err, res) => {
                    if (err) reject(err); else resolve(res)
                },
            )
        })
    }

    startHeartbeat(metrics: MetricsCollector): void {
        if (this.heartbeat !== null) return
        const md = new grpc.Metadata()
        md.set('x-cmdhub-node-id', this.opts.nodeId)
        md.set('x-cmdhub-node-fingerprint', this.opts.certFingerprint)
        this.heartbeat = this.stub.heartbeat(md)
        this.heartbeat.on('error', () => { /* connection broke; reconnect logic is future work */ })
        this.heartbeat.on('end', () => { this.heartbeat = null })

        const interval = this.opts.heartbeatIntervalMs ?? 15_000
        this.heartbeatTimer = setInterval(() => {
            if (this.stopped || !this.heartbeat) return
            const samples = metrics.snapshot()
            this.heartbeat.write({ timestampMs: Date.now(), samples })
        }, interval)
        this.heartbeatTimer.unref()
    }

    stop(): void {
        if (this.stopped) return
        this.stopped = true
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer)
            this.heartbeatTimer = null
        }
        if (this.heartbeat) {
            try { this.heartbeat.end() } catch { /* swallow */ }
            this.heartbeat = null
        }
        this.stub.close()
    }
}
