// TODO some how create argument selection context for saveing prev selected arg to set next arg in one command.
//      e.g. for command set variable: set service_123 var1 path_to_some __jopa__. if pipe service name to next option selection we can asses to service config scope.

import { IManager } from "@core/db"
import { BaseUIContext } from "@core/ui"
import { CmdDispatcher } from "@core/ui/command-processor"

type SetterPattern = (...args: any[]) => Promise<string[]>
export type CmdArgumentOptionSetter = (cmdName: string, dispatcher: CmdDispatcher<any>, manager: IManager) => Promise<string[]>
export type CmdArgumentPairOptionsType<OptionsSetter extends SetterPattern = CmdArgumentOptionSetter> = string[]|OptionsSetter

export function isOptionSetterFunc<OptionsSetter extends SetterPattern = CmdArgumentOptionSetter>(options: CmdArgumentPairOptionsType<OptionsSetter>): options is OptionsSetter {
    return typeof options === 'function'
}

export function isOptionSetterString(options: CmdArgumentPairOptionsType): options is string[] {
    return Array.isArray(options)
}

export async function exposeCmdArgumentOptions<CtxType extends BaseUIContext = any>(
    cmdName: string,
    options: CmdArgumentPairOptionsType<CmdArgumentOptionSetter>|undefined,
    dispatcher: CmdDispatcher<CtxType>,
    manager: IManager
) {
    if (options instanceof Function) {
        return await options(cmdName, dispatcher, manager)
    } else if (Array.isArray(options)) {
        return options
    } else {
        return undefined
    }
}
