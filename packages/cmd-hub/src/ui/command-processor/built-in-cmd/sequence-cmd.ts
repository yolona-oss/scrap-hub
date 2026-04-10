import log from '@logger';
import { BuiltInSeqCommandsEnum } from "../constants"
import { CmdDispatcher } from "../dispatcher"
import { BuiltInCommand } from "../types/built-in-cmd"
import { anyToString } from "@core/utils/misc"
import { BaseUIContext } from "@core/ui"

async function handle(this: CmdDispatcher<any>, ctx: BaseUIContext, cmd: string) {
    const userId = String(ctx.manager!.userId)
    try {
        const res = this.SequenceHandler.handle(userId, cmd)
        if (res) {
            if (res.markup?.text) {
                await ctx.reply(res.markup?.text)
            }
            if (!res.success) {
                throw new Error(`${res.markup?.text ?? "Unknown error"}`)
            }
        }
    } catch (e: any) {
        log.error(`Sequence handling error: ` + e)
        await ctx.reply(`Sequence handling error: ${anyToString(e)}`)
    }
}

const NextInSeqCommand: BuiltInCommand = {
    command: BuiltInSeqCommandsEnum.NEXT_COMMAND,
    description: "Proceed in current command sequnce.",
    invokable: async function(this: CmdDispatcher<any>, _, ctx) {
        await handle.bind(this)(ctx, BuiltInSeqCommandsEnum.NEXT_COMMAND)
    }
}

/////////////////////////

const BackInSeqCommand: BuiltInCommand = {
    command: BuiltInSeqCommandsEnum.BACK_COMMAND,
    description: "Go back in current command sequnce.",
    invokable: async function(this: CmdDispatcher<any>, _, ctx) {
        await handle.bind(this)(ctx, BuiltInSeqCommandsEnum.BACK_COMMAND)
    }
}

/////////////////////////

const CancelSeqCommand: BuiltInCommand = {
    command: BuiltInSeqCommandsEnum.CANCEL_COMMAND,
    description: "Cancel current command sequnce.",
    invokable: async function(this: CmdDispatcher<any>, _, ctx) {
        await handle.bind(this)(ctx, BuiltInSeqCommandsEnum.CANCEL_COMMAND)
    }
}

/////////////////////////

export {
    NextInSeqCommand,
    BackInSeqCommand,
    CancelSeqCommand
}
