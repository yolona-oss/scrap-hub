import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { CmdArgument } from "../../../ui/types/command"
import { UiUnicodeSymbols } from "../../../ui"
import { TableDesigner } from "../../../utils/table-designer"
import { CAP_InvitationLinkRepo } from '@cmd-hub/common'
import crypto from 'crypto'

class InviteArgs {
    @CmdArgument({
        required: false,
        standalone: true,
        description: "List all invitation links"
    })
    list?: string

    @CmdArgument({
        required: false,
        description: "Expiration time (e.g. 1h, 24h, 7d). Empty = no expiry",
        pairOptions: ['1h', '24h', '7d', '30d'],
    })
    expires?: string
}

function parseExpiry(str?: string): number | undefined {
    if (!str) return undefined
    const match = str.match(/^(\d+)(m|h|d)$/)
    if (!match) return undefined
    const n = parseInt(match[1])
    switch (match[2]) {
        case 'm': return n * 60 * 1000
        case 'h': return n * 60 * 60 * 1000
        case 'd': return n * 24 * 60 * 60 * 1000
        default: return undefined
    }
}

export const InviteCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.INVITE,
    description: "Create or list invitation links (admin only)",
    args: new InviteArgs,
    requires: [CAP_InvitationLinkRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        if (!ctx.manager?.isAdmin) {
            await ctx.reply(`${UiUnicodeSymbols.error} Admin access required`)
            return
        }

        const repo = this.requireRepos('invite').invitationLink
        const doList = args.has('list')

        if (doList) {
            const links = await repo.listRecent(20)
            if (links.length === 0) {
                await ctx.reply(`${UiUnicodeSymbols.info} No invitation links yet.`)
                return
            }

            const designer = new TableDesigner()
            const table = designer.make({
                title: `${UiUnicodeSymbols.gear} Invitation links`,
                header: ['Token', 'Used', 'Used By', 'Expires'],
                body: links.map(l => [
                    l.token.slice(0, 8) + '...',
                    l.used ? 'yes' : 'no',
                    l.usedBy ? String(l.usedBy) : '-',
                    l.expiresAt ? l.expiresAt.toISOString().slice(0, 16) : 'never',
                ]),
            }, ctx.manager?.messageWidth ?? 72)

            await ctx.reply(`<pre>${table}</pre>`, { parse_mode: 'HTML' })
            return
        }

        // Create new invite
        const expiresStr = args.get('expires')
        const expiresMs = parseExpiry(expiresStr)
        const token = crypto.randomUUID()
        const expiresAt = expiresMs ? new Date(Date.now() + expiresMs) : undefined

        await repo.create({ token, createdBy: ctx.manager.userId, expiresAt })

        const expiryText = expiresAt
            ? `expires ${expiresAt.toISOString().slice(0, 16)}`
            : 'no expiry'

        await ctx.reply(
            `${UiUnicodeSymbols.success} Invitation created (${expiryText})\n\n` +
            `Token: ${token}\n` +
            `Web link: /invite/${token}`
        )
    }
}
