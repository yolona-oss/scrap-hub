import { CqContext } from "@core/ui/impls/telegram/types";
import { getInitialConfig } from "@core/config";
import { Manager, FilesWrapper } from "@core/db";

import { TelegramUI } from "../telegram-ui";
import { auth_cb_prefix } from "./callback";

import * as tg from "telegraf";

export let actions = (() => {

    async function approverequest(this: TelegramUI, ctx: CqContext, next: () => void) {
        let id = ctx.match.input.slice(auth_cb_prefix.directJoinRequestToAdmin.length);
        let keyboard = tg.Markup.inlineKeyboard([
            [
                {
                    text: "Approve",
                    callback_data: auth_cb_prefix.approveJoinRequest + " " + id
                },
                {
                    text: "Reject",
                    callback_data: auth_cb_prefix.rejectJoinRequest + " " + id
                }
            ]
        ])

        await ctx.telegram.sendMessage(getInitialConfig().bot.admin_id, "Approve request from @" + ctx.from!.username,
            keyboard);
        next();
    }

    async function approvemanager(this: TelegramUI, ctx: CqContext, next: () => void) {
        let userId = Number(ctx.match.input.slice(auth_cb_prefix.approveJoinRequest.length));
        let member = await this.bot.telegram.getChatMember(userId, userId);
        await Manager.create({
            userId: userId,
            name: member.user.first_name + " " + member.user.last_name,
            avatar: (await FilesWrapper.getDefaultAvatar())!.id,
            useGreeting: true
        })

        await this.bot.telegram.sendMessage(userId, "Your request have been accepted. Now you are can use this bot");
        next();
    }

    async function rejectmanager(this: TelegramUI, ctx: CqContext, next: () => void) {
        let userId = Number(ctx.match.input.slice(auth_cb_prefix.rejectJoinRequest.length));
        await this.bot.telegram.sendMessage(userId, "Your request have been rejected");
        // this.bot.telegram.sendSticker(userId, this.stickers.evil);
        next();
    }

    return {
        approverequest,
        approvemanager,
        rejectmanager
    }
})()
