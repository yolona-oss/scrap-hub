import * as telegraf from 'telegraf'
import { log, type IAuthGate, type IUI } from '@cmd-hub/common'
import { anyToString } from '@cmd-hub/core'

import type { TgContext, CqContext } from './types'
import { auth_cb_prefix, decodeCbData } from './constants/callback'
import type { TelegramUI } from './telegram-ui'

/** Default Telegram auth gate: identifies via `ctx.from.id`, exempts the
 *  initial join-request callback, and challenges with an "Approve request"
 *  inline button targeting `primaryAdminId`. The three callback handlers
 *  (`sendJoinRequestToAdmin`, `approveJoinRequest`, `rejectJoinRequest`) live
 *  on the gate so the flow lives in one place. */
export class TelegramAuthGate implements IAuthGate<TgContext, TgContext> {
    constructor(private readonly ui: TelegramUI) {}

    async identify(raw: TgContext): Promise<{ userIdLookup: string | number } | null> {
        const id = raw.from?.id
        return id !== undefined ? { userIdLookup: id } : null
    }

    isExempt(raw: TgContext): boolean {
        const update = raw.update
        if (!update || !('callback_query' in update)) return false
        const cq = update.callback_query
        if (!('data' in cq)) return false
        return cq.data.includes(auth_cb_prefix.directJoinRequestToAdmin)
    }

    async challenge(raw: TgContext, _ui: IUI<TgContext>): Promise<void> {
        const botName = this.ui.requireTgConfig('TelegramAuthGate.challenge').botName
        const sent = await raw.replyWithMarkdownV2(
            `Welcome to ${botName}\\. To start using the bot you need approval from an administrator\\.\nClick the button to send a request\\.`,
            telegraf.Markup.inlineKeyboard([
                [{ text: 'Send', callback_data: auth_cb_prefix.directJoinRequestToAdmin + ' ' + raw.from!.id }],
            ]),
        )
        this.ui.lifecycle.track(String(raw.from!.id), String(sent.message_id), 'system')
    }

    /** Handler for the user-side "Send" button. Forwards the request to the
     *  primary admin with Approve / Reject buttons. */
    async onSendJoinRequestToAdmin(ctx: CqContext, next: () => void): Promise<void> {
        try {
            const id = decodeCbData.auth.joinReqRedirection(ctx.match.input)
            const keyboard = telegraf.Markup.inlineKeyboard([
                [
                    { text: 'Approve', callback_data: auth_cb_prefix.approveJoinRequest + ' ' + id },
                    { text: 'Reject', callback_data: auth_cb_prefix.rejectJoinRequest + ' ' + id },
                ],
            ])
            const adminId = this.ui.requireTgConfig('onSendJoinRequestToAdmin').primaryAdminId
            const sent = await this.ui.bot.telegram.sendMessage(
                adminId,
                'Approve request from @' + ctx.from!.username,
                keyboard,
            )
            this.ui.lifecycle.track(String(adminId), String(sent.message_id), 'system')
        } catch (e: unknown) {
            log.error(`TelegramAuthGate.onSendJoinRequestToAdmin: ${anyToString(e)}`)
        }
        next()
    }

    /** Handler for the admin-side "Approve" button. Creates the manager record. */
    async onApproveJoinRequest(ctx: CqContext, next: () => void): Promise<void> {
        try {
            const userId = Number(decodeCbData.auth.joinReqApprove(ctx.match.input))
            const member = await this.ui.bot.telegram.getChatMember(userId, userId)
            await this.ui.requireRepos('onApproveJoinRequest').manager.createWithAccount({
                userId,
                name: member.user.first_name + ' ' + member.user.last_name,
                useGreeting: true,
            })
            await this.ui.trackedSend(userId, 'Your request has been accepted. You can use the bot now.', 'system')
        } catch (e: unknown) {
            log.error(`TelegramAuthGate.onApproveJoinRequest: ${anyToString(e)}`)
        }
        next()
    }

    /** Handler for the admin-side "Reject" button. */
    async onRejectJoinRequest(ctx: CqContext, next: () => void): Promise<void> {
        try {
            const userId = Number(decodeCbData.auth.joinReqReject(ctx.match.input))
            await this.ui.trackedSend(userId, 'Your request has been rejected.', 'system')
        } catch (e: unknown) {
            log.error(`TelegramAuthGate.onRejectJoinRequest: ${anyToString(e)}`)
        }
        next()
    }
}
