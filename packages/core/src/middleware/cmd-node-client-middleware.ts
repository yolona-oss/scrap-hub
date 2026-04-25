import { IAppMiddleware, Phase, AppLike } from '@cmd-hub/common'
import {
    GrpcCmdNodeClient,
    CAP_NodeChannelResolver,
    CAP_CmdNodeClient,
    type ICmdNodeClient,
} from '@cmd-hub/transport'

/**
 * Builds a hub-side `ICmdNodeClient` from the in-memory channel resolver
 * published by `GrpcServerMiddleware` (as `CAP_NodeChannelResolver`), and
 * publishes the client as `CAP_CmdNodeClient` for `CmdHubApp` to wire
 * into the `RemoteCmdInvoker` + built-in commands.
 *
 * No config contribution.
 * Phase: Services (installs after Transport).
 */
export class CmdNodeClientMiddleware implements IAppMiddleware {
    readonly name = 'CmdNodeClientMiddleware'
    readonly phase = Phase.Services

    async install(app: AppLike): Promise<void> {
        const resolver = app.get(CAP_NodeChannelResolver)
        if (!resolver) {
            throw new Error(
                'CmdNodeClientMiddleware requires CAP_NodeChannelResolver — ' +
                'install GrpcServerMiddleware first',
            )
        }
        const client: ICmdNodeClient = new GrpcCmdNodeClient(resolver)
        app.provide(CAP_CmdNodeClient, client)
    }

    async uninstall(app: AppLike): Promise<void> {
        app.revoke(CAP_CmdNodeClient)
    }
}
