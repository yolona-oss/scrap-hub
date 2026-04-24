// Runtime option-setter helper + narrowed type aliases.
// The generic `CmdArgumentOptionSetterGeneric` lives in @cmd-hub/common;
// cmd-hub re-exports it narrowed so decorators authored on the hub side get
// full dispatcher / manager inference without annotating every callback.

import type { CmdArgumentOptionSetterGeneric, CmdArgumentPairOptionsType as CommonPair } from "@cmd-hub/common"
import {
    isOptionSetterFunc as commonIsOptionSetterFunc,
    isOptionSetterString,
} from "@cmd-hub/common"
import { IManager } from "@core/db"
import { BaseUIContext } from "@core/ui"
import { CmdDispatcher } from "@core/ui/command-processor"

export type CmdArgumentOptionSetter = CmdArgumentOptionSetterGeneric<CmdDispatcher<any>, IManager>
export type CmdArgumentPairOptionsType<
    OptionsSetter extends (...args: any[]) => Promise<string[]> = CmdArgumentOptionSetter,
> = CommonPair<OptionsSetter>

export const isOptionSetterFunc = commonIsOptionSetterFunc
export { isOptionSetterString }

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
