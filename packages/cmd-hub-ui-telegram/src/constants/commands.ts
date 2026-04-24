import { FilesWrapper, Manager } from '@cmd-hub/core';

import { TelegramUI } from '../telegram-ui'
import { TgCommand, TextContext, TgContext } from '../types'
import { shuffle } from '@cmd-hub/core';
import { CmdArgument } from '@cmd-hub/core';
import { log } from '@cmd-hub/common';
import { anyToString } from '@cmd-hub/core';
import { ICmdRegisterEntry } from '@cmd-hub/core';
import { BaseUIContext } from '@cmd-hub/core';
import { CmdArgumentProxy } from '@cmd-hub/core';

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
        const name = args.getOrThrow("name")

        await ctx.manager!.updateOne({ $set: { name: name } });
        await this.trackedSend(ctx.manager!.userId, "Now your will called " + name, 'result')
    }
}

const SetAvatarFromAccountCommand: TgCommand = {
    command: "set_avatar_from_account",
    description: "Update your avatar from current on account",
    invokable: async function(this: TelegramUI, _, ctx) {
        let photos = await (ctx as TextContext).telegram.getUserProfilePhotos((ctx as TextContext).from.id, 0, 1);
        let file   = await (ctx as TextContext).telegram.getFile(photos.photos[0][0].file_id);
        let url    = await (ctx as TextContext).telegram.getFileLink(file.file_id);
        let l_file = await FilesWrapper.saveFile(url.href, "avatars");
        if (l_file) {
            await ctx.manager!.updateOne({ $set: { avatar: l_file.id } });
        } else {
            await this.trackedSend(ctx.manager!.userId, "Loading error. Try another time ^_^", 'system')
        }
    }
}

const GoOfflineCommand: TgCommand = {
    command: "gooffline",
    description: "Go offline",
    invokable: async function(this: TelegramUI, _, ctx) {
        await ctx.manager!.updateOne({ $set: { online: false } });
    },
}

const GoOnlineCommand: TgCommand = {
    command: "goonline",
    description: "Go online",
    invokable: async function(this: TelegramUI, _, ctx) {
        await ctx.manager!.updateOne({ $set: { online: true } });
    },
}

const StatusCommand: TgCommand = {
    command: "status",
    description: "Get your status",
    invokable: async function(this: TelegramUI, _, ctx) {
        await this.trackedSend(ctx.manager!.userId, "Your status: " + (ctx.manager!.online ? "online" : "offline"), 'result')
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

        await ctx.manager!.updateOne({ $set: { useGreeting: (greeting === 'on') } });
        await this.trackedSend(ctx.manager!.userId, "Startup greeting setted to: " + greeting, 'result')
    }
}

const WipeChatCommand: TgCommand = {
    command: "wipe_chat",
    description: "Wipe all chat messages",
    args: [],
    invokable: async function(this: TelegramUI, _, ctx) {
        const chatId = (ctx as TgContext).chat!.id
        const manager = await Manager.findById(ctx.manager!.id)
        if (!manager) return

        const history = await manager.getMessagesHistory()
        let deleted = 0
        let failed = 0

        for (const msg of history) {
            if (!msg.message_id) continue
            try {
                await this.bot.telegram.deleteMessage(chatId, msg.message_id)
                deleted++
            } catch (_) {
                failed++
            }
            try {
                await manager.deleteMessage(msg.message_id)
            } catch (e) {
                log.debug(`Wipe chat: failed to remove history entry ${msg.message_id}: ${anyToString(e)}`)
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
    SetAvatarFromAccountCommand,
    GoOfflineCommand,
    GoOnlineCommand,
    StatusCommand,
    SetGreetingCommand,
    WipeChatCommand
]
