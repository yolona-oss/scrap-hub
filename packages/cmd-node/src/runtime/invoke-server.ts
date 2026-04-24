import * as grpc from '@grpc/grpc-js'
import {
    CmdNodeServiceService,
    type CmdNodeServiceServer,
    type ConfigReloadRequest,
    type ConfigReloadResponse,
    type GetManifestRequest,
    type InvokeClient,
    type InvokeServer,
    type InvokeStart,
    type NodeManifest,
} from '@core/grpc/generated/cmd_node'
import { InvokeWriter } from './event-adapter'
import { dispatchIntercom, IntercomReceiver } from './intercom-dispatch'

/**
 * Turns an InvokeStart into a live service. The executor wires its own
 * service's event emitter to the writer (typically via adaptService) and
 * returns:
 *   receiver   — reverse-channel target for Intercom/cancel messages
 *   stopAdapter — tear down event listeners when the invocation ends
 *   done       — resolves when the service has emitted its `done` event
 */
export interface InvokeExecutor {
    (
        start: InvokeStart,
        writer: InvokeWriter,
    ): Promise<{ receiver: IntercomReceiver; stopAdapter: () => void; done: Promise<void> }>
}

export interface InvokeServerDeps {
    executor: InvokeExecutor
}

export function makeInvokeServerImpl(deps: InvokeServerDeps): CmdNodeServiceServer {
    return {
        invoke(call: grpc.ServerDuplexStream<InvokeClient, InvokeServer>) {
            let state: {
                receiver: IntercomReceiver
                stopAdapter: () => void
                donePromise: Promise<void>
            } | null = null
            let started = false

            const writer: InvokeWriter = (msg) => {
                try { call.write(msg) } catch { /* stream closed */ }
            }

            call.on('data', (msg: InvokeClient) => {
                void (async () => {
                    if (msg.start !== undefined && !started) {
                        started = true
                        try {
                            const result = await deps.executor(msg.start, writer)
                            state = {
                                receiver: result.receiver,
                                stopAdapter: result.stopAdapter,
                                donePromise: result.done,
                            }
                            result.done.finally(() => {
                                state?.stopAdapter()
                                try { call.end() } catch { /* ignore */ }
                            })
                        } catch (err) {
                            writer({ seq: 1, error: { text: (err as Error).message } })
                            writer({ seq: 2, done: { finalMessage: '' } })
                            try { call.end() } catch { /* ignore */ }
                        }
                        return
                    }
                    if (!state) return
                    await dispatchIntercom(state.receiver, msg)
                })()
            })

            call.on('end', () => {
                if (state) state.stopAdapter()
                try { call.end() } catch { /* ignore */ }
            })
            call.on('error', () => {
                if (state) state.stopAdapter()
            })
        },

        configReload(
            _call: grpc.ServerUnaryCall<ConfigReloadRequest, ConfigReloadResponse>,
            callback: grpc.sendUnaryData<ConfigReloadResponse>,
        ) {
            // v1 acknowledges without doing anything — nodes re-read config on each invocation.
            callback(null, { acknowledged: true })
        },

        getManifest(
            _call: grpc.ServerUnaryCall<GetManifestRequest, NodeManifest>,
            callback: grpc.sendUnaryData<NodeManifest>,
        ) {
            // The runtime that owns the CmdNodeApp supplies this via override.
            // Default impl returns an empty manifest; the integration test overrides it.
            callback(null, {
                nodeId: '',
                nodeName: '',
                version: '',
                commands: [],
                services: [],
                configs: [],
                hardware: { cpuCores: 0, totalMemoryBytes: 0, os: '', arch: '', hostname: '' },
                metrics: { gauges: [], counters: [], histograms: [] },
            })
        },
    }
}

export interface NodeGrpcServerOptions {
    bindAddress: string
    credentials: grpc.ServerCredentials
    impl: CmdNodeServiceServer
}

export interface NodeGrpcServerHandle {
    readonly boundAddress: string
    readonly port: number
    shutdown(): Promise<void>
}

export async function startNodeGrpcServer(opts: NodeGrpcServerOptions): Promise<NodeGrpcServerHandle> {
    const server = new grpc.Server()
    server.addService(CmdNodeServiceService, opts.impl)
    const port = await new Promise<number>((resolve, reject) => {
        server.bindAsync(opts.bindAddress, opts.credentials, (err, p) => {
            if (err) reject(err); else resolve(p)
        })
    })
    const host = opts.bindAddress.split(':')[0]
    const boundAddress = `${host}:${port}`
    return {
        boundAddress,
        port,
        async shutdown() {
            await new Promise<void>((resolve) => server.tryShutdown(() => resolve()))
        },
    }
}
