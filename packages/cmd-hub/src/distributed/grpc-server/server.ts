import * as grpc from '@grpc/grpc-js'
import { CmdHubServiceService } from '../../grpc/generated/cmd_node'
import { makeCmdHubServiceImpl, type CmdHubServiceDeps } from './cmd-hub-service-impl'

export interface HubGrpcServerOptions extends CmdHubServiceDeps {
    /** e.g. "0.0.0.0:50051". Use "localhost:0" in tests for an ephemeral port. */
    bindAddress: string
    /**
     * Server credentials. Tests pass ServerCredentials.createInsecure(); real
     * deployments pass the mTLS credentials built in Task 2.4.
     */
    credentials: grpc.ServerCredentials
}

export interface HubGrpcServerHandle {
    readonly boundAddress: string
    readonly port: number
    shutdown(): Promise<void>
}

export async function startHubGrpcServer(opts: HubGrpcServerOptions): Promise<HubGrpcServerHandle> {
    const server = new grpc.Server()
    server.addService(CmdHubServiceService, makeCmdHubServiceImpl(opts))

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
