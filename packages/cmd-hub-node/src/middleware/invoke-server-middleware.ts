import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import { IAppMiddleware, ConfigContributor, Phase, AppLike } from '@cmd-hub/common'
import {
    startNodeGrpcServer,
    makeInvokeServerImpl,
    type NodeGrpcServerHandle,
    type IExecutor,
} from '../runtime/invoke-server'

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
 * Reads from the app:
 *   _executor — built by CmdNodeApp from registered services, exposes
 *               createService() + getManifest() for the gRPC impl to consume.
 *
 * Stashes on the app:
 *   _invokeServer — the NodeGrpcServerHandle
 *   _invokeBoundAddress — actual bound `host:port` (picked by the kernel when
 *                         `bindAddress` used port 0).
 */
export class InvokeServerMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'InvokeServerMiddleware'
    readonly phase = Phase.Transport
    readonly namespace = 'invokeServer'
    readonly schema = InvokeServerConfigSchema

    private handle: NodeGrpcServerHandle | null = null

    constructor(private readonly opts: InvokeServerMiddlewareOptions = {}) {}

    async install(app: AppLike): Promise<void> {
        const cfg = (app.config as { invokeServer: InvokeServerConfig }).invokeServer
        const executor = ((app as unknown) as { _executor?: IExecutor })._executor
        if (!executor) {
            throw new Error(
                'InvokeServerMiddleware requires _executor on the app — ' +
                'CmdNodeApp must build it before install()',
            )
        }

        const credentials = this.opts.credentials ?? grpc.ServerCredentials.createInsecure()
        this.handle = await startNodeGrpcServer({
            bindAddress: cfg.bindAddress,
            credentials,
            impl: makeInvokeServerImpl({ executor }),
        })

        ;(app as unknown as { _invokeServer: NodeGrpcServerHandle })._invokeServer = this.handle
        ;(app as unknown as { _invokeBoundAddress: string })._invokeBoundAddress =
            this.handle.boundAddress
    }

    async uninstall(app: AppLike): Promise<void> {
        if (this.handle) {
            try { await this.handle.shutdown() } catch { /* ignore */ }
            this.handle = null
        }
        ;(app as unknown as { _invokeServer: NodeGrpcServerHandle | null })._invokeServer = null
        ;(app as unknown as { _invokeBoundAddress: string })._invokeBoundAddress = ''
    }
}
