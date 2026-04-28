import {
    branch,
    type OptionsTree,
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
 * Synthesize an `OptionsTree` for a command, regardless of whether it
 * lives in the local registry (one-shot, built-in, service) or on a
 * remote cmd-node (manifest-aggregated).
 *
 * The tree shape depends on the command's kind:
 *
 *   - **service**: root branch with three children — `config`, `params`,
 *     `messages` — each tree built from the corresponding `@CmdService`
 *     data class. While the service is active, only `messages` is
 *     populated (the user has already configured the rest); otherwise
 *     `config` + `params` carry the full configuration surface.
 *
 *   - **local one-shot / built-in**: `buildTreeFromClass(args)` where
 *     `args` is the `@CmdArgument`-decorated class on the command's
 *     `args` slot. Argless commands get an empty branch.
 *
 *   - **remote**: `protoToTree(command.options)` — the proto already
 *     carries an `OptionsTree` per task #391-#393's wire schema.
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
                ? { options: this.buildServiceOptions(local.invokable as ICmdService, userId, dispatcher) }
                : { options: this.buildOneShotOptions(local) }
        }
        const remote = dispatcher.tryGetRemoteCommand(command)
        if (remote) {
            return { options: this.buildRemoteOptions(remote) }
        }
        throw new Error(
            `CBDescriptorCompiler: command "${command}" is not registered locally and not served by any attached node`,
        )
    }

    /** Service tree: root branch with `config` / `params` / `messages`
     *  children. While the service is active, the `config` and `params`
     *  branches collapse to empty so the markuper only renders the
     *  `messages` slice — matching the old `selectReadingContexts`
     *  active/inactive split. */
    private buildServiceOptions(
        service: ICmdService,
        userId: string,
        dispatcher: AnyDispatcher,
    ): OptionsTree {
        const isActive = dispatcher.isServiceActive(userId, service.name)
        const config = isActive ? branch({}) : service.configTree()
        const params = isActive ? branch({}) : service.paramsTree()
        const messages = service.messagesTree()
        return branch({ config, params, messages })
    }

    private buildOneShotOptions(entry: AnyEntry): OptionsTree {
        return entry.options
    }

    private buildRemoteOptions(remote: RemoteCommandSpec): OptionsTree {
        // The aggregator already decoded the proto on attach
        // (see cmd-hub-service-impl.ts toAggregated); options is an
        // OptionsTree, not the proto shape. Decoding again would yield
        // an empty branch and the builder would refuse to open.
        return remote.options ?? branch({})
    }
}
