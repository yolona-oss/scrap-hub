// Runtime option-setter helper + narrowed type aliases.
// The generic `CmdArgumentOptionSetterGeneric` lives in @cmd-hub/common;
// cmd-hub re-exports it narrowed so decorators authored on the hub side get
// full dispatcher / manager inference without annotating every callback.

import type {
    CmdArgumentOptionSetterGeneric,
    CmdArgumentPairOptionsType as CommonPair,
    ManagerRecord,
} from "@cmd-hub/common"
import {
    isOptionSetterFunc as commonIsOptionSetterFunc,
    isOptionSetterString,
} from "@cmd-hub/common"
import { BaseUIContext } from "../../../../ui"
import { CmdDispatcher } from "../../../../ui/command-processor"

export type CmdArgumentOptionSetter = CmdArgumentOptionSetterGeneric<CmdDispatcher<any>, ManagerRecord>
export type CmdArgumentPairOptionsType<
    OptionsSetter extends (...args: any[]) => Promise<string[]> = CmdArgumentOptionSetter,
> = CommonPair<OptionsSetter>

export const isOptionSetterFunc = commonIsOptionSetterFunc
export { isOptionSetterString }

export async function exposeCmdArgumentOptions<CtxType extends BaseUIContext = any>(
    cmdName: string,
    options: CmdArgumentPairOptionsType<CmdArgumentOptionSetter>|undefined,
    dispatcher: CmdDispatcher<CtxType>,
    manager: ManagerRecord,
) {
    if (options instanceof Function) {
        return await options(cmdName, dispatcher, manager)
    } else if (Array.isArray(options)) {
        return options
    } else {
        return undefined
    }
}
