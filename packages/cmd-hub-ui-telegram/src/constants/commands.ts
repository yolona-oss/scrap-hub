import { TelegramUI } from '../telegram-ui'
import { TgCommand, TgContext } from '../types'
import { ICmdRegisterEntry } from '@cmd-hub/core'

export function toRegister(cmd: TgCommand): ICmdRegisterEntry<TgContext> {
    return {
        command: {
            command: cmd.command,
            description: cmd.description,
            args: cmd.args,
        },
        invokable: cmd.invokable
    }
}

const StartCommand: TgCommand = {
    command: "start",
    description: "Start dummy command",
    invokable: async function(this: TelegramUI, _, ctx) {
        await this.trackedSend(ctx.manager!.userId, "Hello, dummy comman here :-)", 'result')
    }
}

/** Telegram-only built-ins. Manager-state commands (`/setname`, `/goonline`,
 *  `/gooffline`, `/status`, `/setgreeting`, `/wipe_chat`) are now provided by
 *  `ManagerControlPlugin` from `@cmd-hub/core`; opt in via
 *  `tg.use(new ManagerControlPlugin())` in your bootstrap. */
export const TelegramUI_BuiltIns: TgCommand[] = [
    StartCommand,
]
