import { BaseUIContext, IUICommand } from "../../../ui"
import { IvokeableType, IUI_InvokableCommand } from "../../../ui/types/command"
import type { CapabilityKey } from "@cmd-hub/common"
export type { IHandleResult } from '@cmd-hub/common'

export interface IUICommandEntry<Ctx extends BaseUIContext> extends Omit<IUI_InvokableCommand<Ctx>, 'command'> {
    seqBounded: boolean
    /** Capability keys this command needs at run time. Validated at boot
     *  by `CmdHubApp.run()` before any UI starts accepting requests. */
    requires?: ReadonlyArray<CapabilityKey<unknown>>
}

export interface ICmdRegisterEntry<Ctx extends BaseUIContext> {
    command: IUICommand,
    invokable: IvokeableType<Ctx>
    /** Capability keys this command needs at run time. Surfaced through
     *  `CmdDispatcher.collectRegisteredCommands()` for the hub-side
     *  validator. */
    requires?: ReadonlyArray<CapabilityKey<unknown>>
}
export type ICmdRegisterManyEntry<Ctx extends BaseUIContext> = Array<ICmdRegisterEntry<Ctx>>
