import {
    argBranch,
    type ArgTree,
} from '@cmd-hub/common'
import { BaseUIContext } from '../../../ui'
import { IUICommandDescriptor } from '../../../ui/types'
import { ICmdService } from '../../../ui/types/command'
import { CmdDispatcher, type RemoteCommandSpec } from './../dispatcher'
import { IUICommandEntry } from './../types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDispatcher = CmdDispatcher<any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEntry = IUICommandEntry<any>

/**
 * Synthesize a `ArgTree` for a command, regardless of whether it
 * lives in the local registry (one-shot, built-in, service) or on a
 * remote cmd-node (manifest-aggregated). Returns the descriptor with
 * the user-facing tree at the root and a `slice` that names the wire
 * prefix the parser must reapply when emitting committed values.
 *
 * The tree shape depends on the command's kind:
 *
 *   - **service (build phase)**: the args-class tree as the root,
 *     `slice: 'args'`. The user's --foo --bar resolve directly against
 *     the args tree; no `args →` wrapper button.
 *
 *   - **service (active phase)**: the intercom-class tree as the root,
 *     `slice: 'intercom'`. Pause / resume / stop / export show as root
 *     buttons; no `intercom →` wrapper.
 *
 *   - **local one-shot / built-in**: `buildArgTreeFromClass(args)` where
 *     `args` is the `@CmdArg`-decorated class on the command's
 *     `args` slot. `slice: undefined` — values ride bare on the wire.
 *     Argless commands get an empty branch.
 *
 *   - **remote**: `protoToTree(command.options)` — the proto already
 *     carries an `ArgTree` per task #391-#393's wire schema.
 *     `slice: undefined`.
 */
export class CBDescriptorCompiler {
    constructor() {}

    async compile(
        command: string,
        userId: string,
        dispatcher: AnyDispatcher,
        _ctx: BaseUIContext,
    ): Promise<IUICommandDescriptor> {
        const local = dispatcher.tryGetInvokable(command)
        if (local) {
            const isService = dispatcher.isService(command)
            if (isService) {
                return this.buildServiceDescriptor(local.invokable as ICmdService, userId, dispatcher)
            }
            return { tree: this.buildOneShotOptions(local) }
        }
        const remote = dispatcher.tryGetRemoteCommand(command)
        if (remote) {
            return { tree: this.buildRemoteOptions(remote) }
        }
        throw new Error(
            `CBDescriptorCompiler: command "${command}" is not registered locally and not served by any attached node`,
        )
    }

    /** Service descriptor: the active slice's tree IS the root. While
     *  inactive (build phase) the user picks build-time arguments off
     *  the args tree directly; while active they pick intercom commands
     *  off the intercom tree directly. The wire prefix (`args/` or
     *  `intercom/`) is reapplied at the parser→wire boundary so the
     *  routing in `cmd-node-app.ts` (`sliceArgsByPrefix`) keeps working. */
    private buildServiceDescriptor(
        service: ICmdService,
        userId: string,
        dispatcher: AnyDispatcher,
    ): IUICommandDescriptor {
        const isActive = dispatcher.isServiceActive(userId, service.name)
        return isActive
            ? { tree: service.intercomTree(), slice: 'intercom' }
            : { tree: service.argsTree(), slice: 'args' }
    }

    private buildOneShotOptions(entry: AnyEntry): ArgTree {
        return entry.argsTree
    }

    private buildRemoteOptions(remote: RemoteCommandSpec): ArgTree {
        // The aggregator already decoded the proto on attach
        // (see cmd-hub-service-impl.ts toAggregated); argsTree is an
        // ArgTree, not the proto shape. Decoding again would yield
        // an empty branch and the builder would refuse to open.
        return remote.argsTree ?? argBranch({})
    }
}
