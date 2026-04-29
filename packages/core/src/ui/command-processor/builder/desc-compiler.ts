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
 * Synthesize an `ArgTree` for a command, regardless of whether it
 * lives in the local registry (one-shot, built-in, service) or on a
 * remote cmd-node (manifest-aggregated).
 *
 * The tree shape depends on the command's kind:
 *
 *   - **service**: root branch with two children — `args`, `intercom` —
 *     each tree built from the corresponding `@CmdService` data class.
 *     While the service is active, only `intercom` is populated (the
 *     user has already configured the rest); otherwise `args` carries
 *     the full configuration surface.
 *
 *   - **local one-shot / built-in**: `buildArgTreeFromClass(args)` where
 *     `args` is the `@CmdArg`-decorated class on the command's
 *     `args` slot. Argless commands get an empty branch.
 *
 *   - **remote**: `protoToTree(command.options)` — the proto already
 *     carries an `ArgTree` per task #391-#393's wire schema.
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
            return isService
                ? { tree: this.buildServiceOptions(local.invokable as ICmdService, userId, dispatcher) }
                : { tree: this.buildOneShotOptions(local) }
        }
        const remote = dispatcher.tryGetRemoteCommand(command)
        if (remote) {
            return { tree: this.buildRemoteOptions(remote) }
        }
        throw new Error(
            `CBDescriptorCompiler: command "${command}" is not registered locally and not served by any attached node`,
        )
    }

    /** Service tree: root branch with `args` / `intercom` children.
     *  While the service is active, the `args` branch collapses to empty
     *  so the markuper only renders the `intercom` slice — matching the
     *  old `selectReadingContexts` active/inactive split. */
    private buildServiceOptions(
        service: ICmdService,
        userId: string,
        dispatcher: AnyDispatcher,
    ): ArgTree {
        const isActive = dispatcher.isServiceActive(userId, service.name)
        const args = isActive ? argBranch({}) : service.argsTree()
        const intercom = service.intercomTree()
        return argBranch({ args, intercom })
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
