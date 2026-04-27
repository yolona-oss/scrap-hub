import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import {
    IAppMiddleware,
    ConfigContributor,
    Phase,
    AppLike,
    readConfigSlice,
    log,
    CAP_NodeUiMessageRegistry,
    requireCap,
} from '@cmd-hub/common'
import {
    startNodeGrpcServer,
    makeInvokeServerImpl,
    type NodeGrpcServerHandle,
} from '../runtime/invoke-server'
import {
    CAP_NodeExecutor,
    CAP_NodeInvokeServer,
    CAP_NodeInvokeBoundAddress,
} from '../capabilities'

export const InvokeServerConfigSchema = z.object({
    bindAddress: z.string().min(1),
})

export type InvokeServerConfig = z.infer<typeof InvokeServerConfigSchema>

export interface InvokeServerMiddlewareOptions {
    /** Override server credentials. Defaults to insecure (v1). */
    credentials?: grpc.ServerCredentials
}

/**
 * Starts the node's own gRPC server — the one the hub dials into to open
 * `Invoke` bidi streams. Installs in the Transport phase so HubClientMiddleware
 * (Services phase) sees a bound listen address before calling Register.
 *
 * Required capabilities:
 *   CAP_NodeExecutor — provided by CmdNodeApp before super.Initialize().
 *
 * Published capabilities:
 *   CAP_NodeInvokeServer — the NodeGrpcServerHandle
 *   CAP_NodeInvokeBoundAddress — actual bound `host:port` (picked by the
 *                                kernel when `bindAddress` used port 0).
 */
export class InvokeServerMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'InvokeServerMiddleware'
    readonly phase = Phase.Transport
    readonly namespace = 'invokeServer'
    readonly schema = InvokeServerConfigSchema

    private handle: NodeGrpcServerHandle | null = null

    constructor(private readonly opts: InvokeServerMiddlewareOptions = {}) {}

    async install(app: AppLike): Promise<void> {
        const cfg = readConfigSlice(app, this)
        const executor = app.get(CAP_NodeExecutor)
        if (!executor) {
            throw new Error(
                'InvokeServerMiddleware requires CAP_NodeExecutor — ' +
                'CmdNodeApp must build it before install()',
            )
        }

        const credentials = this.opts.credentials ?? grpc.ServerCredentials.createInsecure()
        const nodeUiMessageRegistry = requireCap(
            app,
            CAP_NodeUiMessageRegistry,
            'InvokeServerMiddleware: framework-provided cap not present (Application.Initialize must run first)',
        )
        this.handle = await startNodeGrpcServer({
            bindAddress: cfg.bindAddress,
            credentials,
            impl: makeInvokeServerImpl({ executor, nodeUiMessageRegistry }),
        })

        app.provide(CAP_NodeInvokeServer, this.handle)
        app.provide(CAP_NodeInvokeBoundAddress, this.handle.boundAddress)
        log.info(`InvokeServer: gRPC bound at ${this.handle.boundAddress} (insecure=${this.opts.credentials === undefined})`)
    }

    async uninstall(app: AppLike): Promise<void> {
        if (this.handle) {
            try { await this.handle.shutdown() } catch { /* ignore */ }
            this.handle = null
        }
        app.revoke(CAP_NodeInvokeServer)
        app.revoke(CAP_NodeInvokeBoundAddress)
    }
}
