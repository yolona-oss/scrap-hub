import { CqContext } from '../types';
import { anyToString } from '@cmd-hub/core'
import { log } from '@cmd-hub/common'

import { TelegramUI } from "../telegram-ui"
import { auth_cb_prefix, decodeCbData } from "./../constants/callback"

import * as tg from "telegraf"

export async function sendJoinRequestToAdmin(this: TelegramUI, ctx: CqContext, next: () => void) {
    try {
        const id = decodeCbData.auth.joinReqRedirection(ctx.match.input)
        const keyboard = tg.Markup.inlineKeyboard([
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

        const adminId = this.requireTgConfig('sendJoinRequestToAdmin').primaryAdminId
        const sent = await this.bot.telegram.sendMessage(adminId, "Approve request from @" + ctx.from!.username, keyboard)
        this.lifecycle.track(String(adminId), String(sent.message_id), 'system')
    } catch (e: unknown) {
        log.error(`Auth: sendJoinRequestToAdmin failed: ${anyToString(e)}`)
    }
    next();
}

export async function approveJoinRequest(this: TelegramUI, ctx: CqContext, next: () => void) {
    try {
        const userId = Number(decodeCbData.auth.joinReqApprove(ctx.match.input))
        const member = await this.bot.telegram.getChatMember(userId, userId)
        await this.requireRepos('approveJoinRequest').manager.createWithAccount({
            userId: userId,
            name: member.user.first_name + " " + member.user.last_name,
            useGreeting: true,
        })

        await this.trackedSend(userId, "Your request have been accepted. Now you are can use this bot", 'system')
    } catch (e: unknown) {
        log.error(`Auth: approveJoinRequest failed: ${anyToString(e)}`)
    }
    next();
}

export async function rejectJoinRequest(this: TelegramUI, ctx: CqContext, next: () => void) {
    try {
        const userId = Number(decodeCbData.auth.joinReqReject(ctx.match.input))
        await this.trackedSend(userId, "Your request have been rejected", 'system')
    } catch (e: unknown) {
        log.error(`Auth: rejectJoinRequest failed: ${anyToString(e)}`)
    }
    next();
}
