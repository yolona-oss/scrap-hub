import { TelegramUI } from '../telegram-ui'
import { TgCommand, TgContext } from '../types'
import { shuffle } from '@cmd-hub/core'
import { CmdArgument } from '@cmd-hub/core'
import { log } from '@cmd-hub/common'
import { anyToString } from '@cmd-hub/core'
import { ICmdRegisterEntry } from '@cmd-hub/core'
import { CmdArgumentProxy } from '@cmd-hub/core'

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

const nameDict = [
    "Valentin",
    "Vladimir",
    "Gandonio",
    "Emperor",
    "Napoleon",
    "Napoleon\\ III",
    "Napoleon\\ IV",
    "Napoleon\\ V",
    "Napoleon\\ VI",
    "Napoleon\\ VII",
    "Napoleon\\ VIII",
    "Napoleon\\ IX",
    "Napoleon\\ X",
    "Napoleon\\ XI",
    "Napoleon\\ XII",
    "Napoleon\\ XIII",
    "Napoleon\\ XIV",
    "Joseph",
    "Pushkin",
    "Pussy",
    "Boba",
    "Boba\\ Fett",
    "Boba\\ Fett\\ II",
]

const StartCommand: TgCommand = {
    command: "start",
    description: "Start dummy command",
    invokable: async function(this: TelegramUI, _, ctx) {
        await this.trackedSend(ctx.manager!.userId, "Hello, dummy comman here :-)", 'result')
    }
}

class SetNameArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Your name, only latin symbols allowed",
        validator: (arg: string) => Boolean(arg.trim().match(/^[a-zA-Z0-9 ]+$/)) && arg.length <= 32 && arg.length >= 4,
        pairOptions: shuffle(nameDict).slice(0, 5)
    })
    name?: String
}

const SetNameCommand: TgCommand = {
    command: "setname",
    description: "Set your name",
    args: SetNameArgs,
    invokable: async function(this: TelegramUI, args: CmdArgumentProxy, ctx) {
        const name = String(args.getOrThrow("name"))
        await this.requireRepos('setname').manager.updateById(ctx.manager!.id, { name })
        await this.trackedSend(ctx.manager!.userId, "Now your will called " + name, 'result')
    }
}

const GoOfflineCommand: TgCommand = {
    command: "gooffline",
    description: "Go offline",
    invokable: async function(this: TelegramUI, _, ctx) {
        await this.requireRepos('gooffline').manager.updateById(ctx.manager!.id, { online: false })
    },
}

const GoOnlineCommand: TgCommand = {
    command: "goonline",
    description: "Go online",
    invokable: async function(this: TelegramUI, _, ctx) {
        await this.requireRepos('goonline').manager.updateById(ctx.manager!.id, { online: true })
    },
}

const StatusCommand: TgCommand = {
    command: "status",
    description: "Get your status",
    invokable: async function(this: TelegramUI, _, ctx) {
        const manager = await this.requireRepos('status').manager.findById(ctx.manager!.id)
        const online = manager?.online ?? false
        await this.trackedSend(ctx.manager!.userId, "Your status: " + (online ? "online" : "offline"), 'result')
    }
}

class SetGreetingArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Disable or enable startup greeting",
        validator: (arg: string) => ["on", "off"].includes(arg),
        pairOptions: ["on", "off"]
    })
    greeting?: String
}

const SetGreetingCommand: TgCommand = {
    command: "setgreeting",
    description: "On or Off bot startup greeting",
    args: SetGreetingArgs,
    invokable: async function(this: TelegramUI, args: CmdArgumentProxy, ctx) {
        const greeting = args.getOrThrow("greeting")
        await this.requireRepos('setgreeting').manager.updateById(ctx.manager!.id, {
            useGreeting: (greeting === 'on'),
        })
        await this.trackedSend(ctx.manager!.userId, "Startup greeting setted to: " + greeting, 'result')
    }
}

const WipeChatCommand: TgCommand = {
    command: "wipe_chat",
    description: "Wipe all chat messages",
    args: [],
    invokable: async function(this: TelegramUI, _, ctx) {
        const chatId = (ctx as TgContext).chat!.id
        const repos = this.requireRepos('wipe_chat')
        const handle = await repos.manager.handleById(ctx.manager!.id)
        if (!handle) return

        const history = await handle.getMessagesHistory()
        let deleted = 0
        let failed = 0

        for (const msg of history) {
            if (!msg.messageId) continue
            try {
                await this.bot.telegram.deleteMessage(chatId, msg.messageId)
                deleted++
            } catch (_) {
                failed++
            }
            try {
                await handle.deleteMessage(msg.messageId)
            } catch (e) {
                log.debug(`Wipe chat: failed to remove history entry ${msg.messageId}: ${anyToString(e)}`)
            }
        }

        // Also clean up lifecycle-tracked messages and dashboards
        const userId = String(ctx.manager!.userId)
        await this.lifecycle.cleanupAll(userId)
        await this.dispatcher.destroyAllDashboards(userId)

        log.info(`Wipe chat: deleted ${deleted}, failed ${failed} (likely >48h old)`)
        await this.trackedSend(ctx.manager!.userId, `Chat wiped: ${deleted} deleted, ${failed} skipped`, 'system')
    }
}

export const TelegramUI_BuiltIns = [
    StartCommand,
    SetNameCommand,
    GoOfflineCommand,
    GoOnlineCommand,
    StatusCommand,
    SetGreetingCommand,
    WipeChatCommand,
]
