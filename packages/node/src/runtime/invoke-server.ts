import * as grpc from '@grpc/grpc-js'
import type { INodeUiMessageRegistry } from '@cmd-hub/common'
import { CmdHubProto } from '@cmd-hub/transport'
import { adaptService } from './event-adapter'
import { dispatchIntercom } from './intercom-dispatch'
import { ValidationFailedError } from './validate-args'

/** RPC-level errors (duplicate InvokeStart, invoke handler crash, etc.)
 *  ride the same UiMessageEnvelope channel as service-emitted errors so
 *  the hub has one wire path to decode. severity='error' tags them as
 *  operator-visible failures. */
function rpcErrorEnvelope(seq: number, text: string): CmdHubProto.InvokeServer {
    return {
        seq,
        uiMessage: {
            kind: 'text',
            payloadJson: Buffer.from(JSON.stringify({ text })),
            severity: 'error',
            compatibilityId: 'cmd-hub.builtin.text',
            version: '1.0.0',
        },
    }
}

function validationFailedEnvelope(seq: number, err: ValidationFailedError): CmdHubProto.InvokeServer {
    return {
        seq,
        validationFailed: {
            argPath: err.argPath,
            message: err.reason,
            rawValue: err.rawValue,
        },
    }
}

type InvokeStart = CmdHubProto.InvokeStart
type InvokeClient = CmdHubProto.InvokeClient
type InvokeServer = CmdHubProto.InvokeServer
type ConfigReloadRequest = CmdHubProto.ConfigReloadRequest
type ConfigReloadResponse = CmdHubProto.ConfigReloadResponse
type GetManifestRequest = CmdHubProto.GetManifestRequest
type NodeManifest = CmdHubProto.NodeManifest

/**
 * Minimal contract the invoke server needs from a "running service":
 *   - event-emitter-shaped `on`/`off`/`emit` so adaptService can splice events
 *     onto the stream. Loose-typed on purpose — concrete services may use a
 *     TypedEventEmitter with a narrow event map and TS variance makes a full
 *     `extends EventEmitter` constraint reject those subclasses.
 *   - receiveMsg() so dispatchIntercom can forward intercom/cancel
 *   - run() to kick off the actual work
 *   - optional terminate() + Initialize() for clean lifecycle
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface RunnableService {
    on(event: string, listener: (...args: any[]) => void): unknown
    off(event: string, listener: (...args: any[]) => void): unknown
    emit(event: string, ...args: any[]): boolean
    receiveMsg(actionId: string, args: string[]): Promise<void>
    run(): Promise<void>
    terminate?(): Promise<void>
    Initialize?(): Promise<void>
}

/**
 * An executor knows how to materialize a `RunnableService` from an InvokeStart
 * (command name, userId, args, serviceDataBlob). CmdNodeApp builds an executor
 * over its registered services; tests pass an in-memory stub.
 */
export interface IExecutor {
    createService(start: InvokeStart): Promise<RunnableService>
    /** Manifest accessor used by the GetManifest RPC. */
    getManifest(): NodeManifest
    /** Optional hook used by the ConfigReload RPC. */
    reloadConfig?(moduleName: string): Promise<boolean>
}

export interface MakeInvokeServerImplOptions {
    executor: IExecutor
    /** Registry the event-adapter consults to look up `compatibilityId` /
     *  `version` for outgoing UiMessage envelopes. */
    nodeUiMessageRegistry: INodeUiMessageRegistry
}

/**
 * Build the `CmdNodeServiceServer` gRPC impl. The returned object is what
 * `grpc.Server.addService(CmdNodeServiceService, impl)` expects.
 */
export function makeInvokeServerImpl(
    opts: MakeInvokeServerImplOptions,
): CmdHubProto.CmdNodeServiceServer {
    const { executor, nodeUiMessageRegistry } = opts

    return {
        invoke(call: grpc.ServerDuplexStream<InvokeClient, InvokeServer>) {
            let svc: RunnableService | null = null
            let stopAdapter: (() => void) | null = null
            let started = false
            let closed = false

            const closeStream = () => {
                if (closed) return
                closed = true
                try { call.end() } catch { /* ignore */ }
                if (stopAdapter) { try { stopAdapter() } catch { /* ignore */ } stopAdapter = null }
            }

            const writer = (msg: InvokeServer) => {
                if (closed) return
                try { call.write(msg) } catch { /* stream already dead */ }
                // Both `done` and `validationFailed` are terminal — flush
                // and close the stream so the hub doesn't keep waiting.
                if (msg.done !== undefined || msg.validationFailed !== undefined) {
                    closeStream()
                }
            }

            call.on('data', (msg: InvokeClient) => {
                void (async () => {
                    try {
                        if (msg.start !== undefined) {
                            if (started) {
                                writer(rpcErrorEnvelope(0, 'duplicate InvokeStart on the same stream'))
                                closeStream()
                                return
                            }
                            started = true
                            try {
                                svc = await executor.createService(msg.start)
                            } catch (err) {
                                // Distinguish authoritative arg-validation
                                // failure from a generic createService crash:
                                // the hub re-prompts the failed leaf instead
                                // of treating the run as a hard error.
                                if (err instanceof ValidationFailedError) {
                                    writer(validationFailedEnvelope(0, err))
                                } else {
                                    writer(rpcErrorEnvelope(0, `service initialization failed: ${(err as Error).message}`))
                                }
                                closeStream()
                                return
                            }
                            stopAdapter = adaptService(svc, writer, nodeUiMessageRegistry)
                            if (typeof svc.Initialize === 'function') {
                                try { await svc.Initialize() } catch (err) {
                                    writer(rpcErrorEnvelope(0, `service initialization failed: ${(err as Error).message}`))
                                    closeStream()
                                    return
                                }
                            }
                            // Fire and forget run() — its events flow through the adapter.
                            svc.run().catch((err) => {
                                writer(rpcErrorEnvelope(0, `service run failed: ${(err as Error).message}`))
                                closeStream()
                            })
                            return
                        }
                        if (!svc) {
                            writer(rpcErrorEnvelope(0, 'received InvokeClient message before InvokeStart'))
                            closeStream()
                            return
                        }
                        await dispatchIntercom(svc, msg)
                    } catch (err) {
                        writer(rpcErrorEnvelope(0, `invoke handler error: ${(err as Error).message}`))
                        closeStream()
                    }
                })()
            })

            call.on('end', () => {
                // Client half-closed. Terminate the service if still running.
                void (async () => {
                    if (svc && typeof svc.terminate === 'function') {
                        try { await svc.terminate() } catch { /* ignore */ }
                    }
                    closeStream()
                })()
            })

            call.on('error', () => {
                void (async () => {
                    if (svc && typeof svc.terminate === 'function') {
                        try { await svc.terminate() } catch { /* ignore */ }
                    }
                    closeStream()
                })()
            })
        },

        configReload(
            call: grpc.ServerUnaryCall<ConfigReloadRequest, ConfigReloadResponse>,
            callback: grpc.sendUnaryData<ConfigReloadResponse>,
        ) {
            void (async () => {
                try {
                    let acknowledged = true
                    if (typeof executor.reloadConfig === 'function') {
                        acknowledged = await executor.reloadConfig(call.request.moduleName)
                    }
                    callback(null, { acknowledged })
                } catch (err) {
                    callback({
                        code: grpc.status.INTERNAL,
                        message: (err as Error).message,
                    } as grpc.ServiceError, null)
                }
            })()
        },

        getManifest(
            _call: grpc.ServerUnaryCall<GetManifestRequest, NodeManifest>,
            callback: grpc.sendUnaryData<NodeManifest>,
        ) {
            try {
                callback(null, executor.getManifest())
            } catch (err) {
                callback({
                    code: grpc.status.INTERNAL,
                    message: (err as Error).message,
                } as grpc.ServiceError, null)
            }
        },
    }
}

export interface NodeGrpcServerOptions {
    bindAddress: string
    credentials: grpc.ServerCredentials
    impl: CmdHubProto.CmdNodeServiceServer
}

export interface NodeGrpcServerHandle {
    readonly boundAddress: string
    readonly port: number
    shutdown(): Promise<void>
}

export async function startNodeGrpcServer(
    opts: NodeGrpcServerOptions,
): Promise<NodeGrpcServerHandle> {
    const server = new grpc.Server()
    server.addService(CmdHubProto.CmdNodeServiceService, opts.impl)

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
            // tryShutdown() waits for every open http2 session to close —
            // including the hub's long-lived Invoke channel to this node.
            // Fall back to forceShutdown after a short grace period so a
            // hung peer (or a hub that hasn't yet noticed our heartbeat
            // ended) can't block our process exit indefinitely.
            const GRACE_MS = 2000
            await new Promise<void>((resolve) => {
                let done = false
                const finish = () => {
                    if (done) return
                    done = true
                    resolve()
                }
                const timer = setTimeout(() => {
                    try { server.forceShutdown() } catch { /* ignore */ }
                    finish()
                }, GRACE_MS)
                timer.unref?.()
                server.tryShutdown(() => {
                    clearTimeout(timer)
                    finish()
                })
            })
        },
    }
}
