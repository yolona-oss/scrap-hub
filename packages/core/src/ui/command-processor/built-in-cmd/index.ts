export * from './account-ctrl-cmd'
export * from './service-ctrl-cmd'
export * from './help-cmd'
export * from './sequence-cmd'
export * from './cmd-alias-ctlr'
export * from './calibrate-cmd'
export * from './dashboard-panel'
export * from './sconfig-cmd'
export * from './config-cmd'
export * from './sinfo-cmd'
export * from './invite-cmd'
export * from './log-cmd'

import { BaseUIContext } from '../../../ui'
import { BuiltInSeqCommandsEnum, BuiltInHelpCommandsEnum, BuiltInAccountCommandsEnum, BuiltInServiceCommandsEnum, BuiltInAliasCommandsEnum, BuiltInUiCommandsEnum } from '../constants'
import { ICmdRegisterEntry } from '../types'
import { BuiltInCommand } from '../types/built-in-cmd'
import { CmdDispatcher } from '../dispatcher'

export const BuiltInCommandNames: string[] = Object.values(BuiltInSeqCommandsEnum)
                                                .concat(Object.values(BuiltInHelpCommandsEnum))
                                                .concat(Object.values(BuiltInAccountCommandsEnum))
                                                .concat(Object.values(BuiltInServiceCommandsEnum))
                                                .concat(Object.values(BuiltInAliasCommandsEnum))
                                                .concat(Object.values(BuiltInUiCommandsEnum))

export function toRegister<UICtx extends BaseUIContext>(
    cmd: BuiltInCommand<UICtx>,
    dispatcher: CmdDispatcher<UICtx>,
): ICmdRegisterEntry<UICtx> {
    return {
        command: {
            command: cmd.command,
            description: cmd.description,
            args: cmd.args,
            next: cmd.next,
            prev: cmd.prev
        },
        invokable: cmd.invokable.bind(dispatcher),
        requires: cmd.requires,
    }
}
