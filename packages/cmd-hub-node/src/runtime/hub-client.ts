import * as grpc from '@grpc/grpc-js'
import { log } from '@cmd-hub/common'
import { CmdHubProto } from '@cmd-hub/transport'
import type { MetricsCollector } from '../manifest/metrics-collector'

type RegisterRequest = CmdHubProto.RegisterRequest
type RegisterResponse = CmdHubProto.RegisterResponse
type HeartbeatClient = CmdHubProto.HeartbeatClient
type HeartbeatServer = CmdHubProto.HeartbeatServer
type NodeManifest = CmdHubProto.NodeManifest

/** Minimal slice of the generated client the runtime uses. Tests swap this
 *  out for in-process fakes. */
export interface IHubServiceClient {
    register(
        request: RegisterRequest,
        metadata: grpc.Metadata,
        callback: (err: grpc.ServiceError | null, resp: RegisterResponse) => void,
    ): grpc.ClientUnaryCall
    heartbeat(metadata: grpc.Metadata): grpc.ClientDuplexStream<HeartbeatClient, HeartbeatServer>
    close(): void
}

function wrapGeneratedClient(raw: CmdHubProto.CmdHubServiceClient): IHubServiceClient {
    return {
        register: (req, md, cb) => raw.register(req, md, cb),
        heartbeat: (md) => raw.heartbeat(md),
        close: () => raw.close(),
    }
}

export interface HubClientOptions {
    address: string
    token: string
    nodeId: string
    /** This node's InvokeServer address — hub dials back here. */
    listenAddress: string
    /** mTLS client-cert fingerprint; on insecure transports doubles as the
     *  metadata-header value. */
    certFingerprint?: string
    heartbeatIntervalMs?: number
    credentials?: grpc.ChannelCredentials
    /** Test seam. */
    client?: IHubServiceClient
}

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
            this.client = wrapGeneratedClient(
                new CmdHubProto.CmdHubServiceClient(opts.address, creds),
            )
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
        log.info(`HubClient: registering "${this.opts.nodeId}" → ${this.opts.address} (${manifest.commands.length} commands)`)
        const resp = await new Promise<RegisterResponse>((resolve, reject) => {
            this.client.register(req, md, (err, r) => {
                if (err) reject(err); else resolve(r)
            })
        })
        this._registerResponse = resp
        log.info(`HubClient: registered (assignedState=${resp.assignedState}, pollInterval=${resp.pollIntervalMs}ms)`)
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

        log.info(`HubClient: heartbeat starting (interval=${intervalMs}ms)`)
        stream.on('data', (_msg: HeartbeatServer) => { /* shutdown signalling tbd */ })
        stream.on('error', (e) => {
            log.warn(`HubClient: heartbeat errored: ${(e as Error)?.message ?? e}`)
            this.stopHeartbeat()
        })
        stream.on('end', () => {
            log.info('HubClient: heartbeat ended')
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

        // First tick is eager so the hub sees liveness without waiting one interval.
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
