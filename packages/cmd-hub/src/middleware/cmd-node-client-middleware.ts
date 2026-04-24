import { IAppMiddleware, Phase, AppLike } from '@cmd-hub/common'
import {
    GrpcCmdNodeClient,
    type InMemoryChannelResolver,
    type ICmdNodeClient,
} from '@cmd-hub/transport'

/**
 * Constructs a hub-side `ICmdNodeClient` from the in-memory channel resolver
 * populated by `GrpcServerMiddleware`. Stashes the client at `app._cmdNodeClient`
 * so `CmdHubApp` can wire it into the `RemoteCmdInvoker`.
 *
 * No config contribution.
 * Phase: Services (installs after Transport).
 */
export class CmdNodeClientMiddleware implements IAppMiddleware {
    readonly name = 'CmdNodeClientMiddleware'
    readonly phase = Phase.Services

    async install(app: AppLike): Promise<void> {
        const resolver = (app as any)._nodeChannelResolver as InMemoryChannelResolver | undefined
        if (!resolver) {
            throw new Error(
                'CmdNodeClientMiddleware requires _nodeChannelResolver on the app — ' +
                'install GrpcServerMiddleware first',
            )
        }
        const client: ICmdNodeClient = new GrpcCmdNodeClient(resolver)
        ;(app as any)._cmdNodeClient = client
    }

    async uninstall(app: AppLike): Promise<void> {
        ;(app as any)._cmdNodeClient = null
    }
}
