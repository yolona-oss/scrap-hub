import * as grpc from '@grpc/grpc-js'
import { CmdHubProto } from '@cmd-hub/transport'
import type { MetricsCollector } from '../manifest/metrics-collector'

type RegisterRequest = CmdHubProto.RegisterRequest
type RegisterResponse = CmdHubProto.RegisterResponse
type HeartbeatClient = CmdHubProto.HeartbeatClient
type HeartbeatServer = CmdHubProto.HeartbeatServer
type NodeManifest = CmdHubProto.NodeManifest

/**
 * Minimal surface of the generated `CmdHubServiceClient` the node runtime needs.
 * Tests swap this out for an in-process fake.
 */
export interface IHubServiceClient {
    register(
        request: RegisterRequest,
        metadata: grpc.Metadata,
        callback: (err: grpc.ServiceError | null, resp: RegisterResponse) => void,
    ): grpc.ClientUnaryCall
    heartbeat(metadata: grpc.Metadata): grpc.ClientDuplexStream<HeartbeatClient, HeartbeatServer>
    close(): void
}

export interface HubClientOptions {
    address: string
    token: string
    nodeId: string
    /** Listen address of THIS node's InvokeServer — hub uses it to dial back. */
    listenAddress: string
    /**
     * mTLS client cert fingerprint. When running against an insecure server
     * this doubles as the header value since there's no TLS handshake to
     * extract it from.
     */
    certFingerprint?: string
    heartbeatIntervalMs?: number
    /** Override channel credentials. Defaults to insecure. */
    credentials?: grpc.ChannelCredentials
    /** Override the underlying client — primarily for tests. */
    client?: IHubServiceClient
}

/**
 * Node-side gRPC client that talks to the hub. Responsible for:
 *  - the Register unary call on boot (manifest upload, fingerprint + token auth)
 *  - the Heartbeat bidi stream (periodic metric samples, server-side shutdown signal)
 *
 * Lifecycle:
 *   const c = new HubClient(opts)
 *   await c.register(manifest)
 *   c.startHeartbeat(metricsCollector)
 *   ...
 *   await c.close()
 */
export class HubClient {
    private readonly client: IHubServiceClient
    private readonly ownsClient: boolean
    private hbStream: grpc.ClientDuplexStream<HeartbeatClient, HeartbeatServer> | null = null
    private hbTimer: NodeJS.Timeout | null = null
    private _registerResponse: RegisterResponse | null = null

    constructor(private readonly opts: HubClientOptions) {
        if (!opts.address) throw new Error('HubClient: address is required')
        if (!opts.token) throw new Error('HubClient: token is required')
        if (!opts.nodeId) throw new Error('HubClient: nodeId is required')

        if (opts.client) {
            this.client = opts.client
            this.ownsClient = false
        } else {
            const creds = opts.credentials ?? grpc.credentials.createInsecure()
            this.client = new CmdHubProto.CmdHubServiceClient(
                opts.address,
                creds,
            ) as unknown as IHubServiceClient
            this.ownsClient = true
        }
    }

    get registerResponse(): RegisterResponse | null {
        return this._registerResponse
    }

    async register(manifest: NodeManifest): Promise<RegisterResponse> {
        const md = new grpc.Metadata()
        if (this.opts.certFingerprint) {
            md.set('x-cmdhub-node-fingerprint', this.opts.certFingerprint)
        }
        md.set('x-cmdhub-node-id', this.opts.nodeId)

        const req: RegisterRequest = {
            nodeId: this.opts.nodeId,
            token: this.opts.token,
            manifest,
            listenAddress: this.opts.listenAddress,
        }
        const resp = await new Promise<RegisterResponse>((resolve, reject) => {
            this.client.register(req, md, (err, r) => {
                if (err) reject(err); else resolve(r)
            })
        })
        this._registerResponse = resp
        return resp
    }

    startHeartbeat(metrics: MetricsCollector): void {
        if (this.hbStream || this.hbTimer) return
        const md = new grpc.Metadata()
        md.set('x-cmdhub-node-id', this.opts.nodeId)
        if (this.opts.certFingerprint) {
            md.set('x-cmdhub-node-fingerprint', this.opts.certFingerprint)
        }
        const intervalMs = this.opts.heartbeatIntervalMs ??
            (this._registerResponse?.pollIntervalMs && this._registerResponse.pollIntervalMs > 0
                ? this._registerResponse.pollIntervalMs
                : 15_000)

        const stream = this.client.heartbeat(md)
        this.hbStream = stream

        // Drain incoming messages — we don't do anything fancy with them yet.
        stream.on('data', (_msg: HeartbeatServer) => { /* shutdown signal handling later */ })
        stream.on('error', (_err) => {
            this.stopHeartbeat()
        })
        stream.on('end', () => {
            this.stopHeartbeat()
        })

        const tick = () => {
            if (!this.hbStream) return
            const samples = metrics.snapshot()
            const msg: HeartbeatClient = {
                timestampMs: Date.now(),
                samples: samples.map((s) => ({ name: s.name, value: s.value, atMs: s.atMs })),
            }
            try { this.hbStream.write(msg) } catch { /* stream closed */ }
        }

        // First tick immediately so the hub sees the node is alive without waiting.
        tick()
        this.hbTimer = setInterval(tick, intervalMs)
        this.hbTimer.unref?.()
    }

    private stopHeartbeat(): void {
        if (this.hbTimer) {
            clearInterval(this.hbTimer)
            this.hbTimer = null
        }
        if (this.hbStream) {
            const s = this.hbStream
            this.hbStream = null
            try { s.end() } catch { /* ignore */ }
        }
    }

    async close(): Promise<void> {
        this.stopHeartbeat()
        if (this.ownsClient) {
            try { this.client.close() } catch { /* ignore */ }
        }
    }
}
