import { Telegraf, type Context } from 'telegraf'
import type { HubDispatcher, SessionIndex, InvokeServer, IHubUIPlugin } from '@cmd-hub/core'

export interface TelegramHubUIOptions {
    botToken: string
    /**
     * HTTP/SOCKS agent if the bot host can't reach Telegram directly. Created
     * from env vars in the bootstrap; injected here so the adapter stays
     * pure.
     */
    httpAgent?: unknown
    /**
     * Admin user IDs (Telegram numeric user id). Receives ctx.manager.isAdmin
     * semantics expected by the /config, /sconfig, /node built-ins. v1 reads
     * this list from env; a full deployment moves the check into a separate
     * auth plugin.
     */
    adminUserIds?: Set<number>
}

/**
 * Minimum viable Telegram UI adapter for the distributed cmd-hub.
 *
 * Shape:
 *   /command arg=val arg2=val   →   dispatcher.handle({ command, args, userId })
 *   The dispatcher's response is streamed back as plain-text messages.
 *
 * Not yet implemented (follow-ups after Phase 3):
 *   - Rich dashboard rendering (ServiceDashboard hookup via HubDispatcher
 *     plus SessionIndex).
 *   - Inline keyboards / intercom buttons.
 *   - Command builder / multi-step UX.
 *
 * These are covered by the dashboard code still in packages/cmd-hub and can
 * be wired later without breaking this adapter's interface.
 */
export class TelegramHubUI implements IHubUIPlugin {
    private bot: Telegraf | null = null

    constructor(private readonly opts: TelegramHubUIOptions) {
        if (!opts.botToken) {
            throw new Error('TelegramHubUI: botToken is required')
        }
    }

    async start(ctx: { dispatcher: HubDispatcher; sessions: SessionIndex }): Promise<void> {
        this.bot = new Telegraf(this.opts.botToken)

        if (this.opts.httpAgent) {
            // Telegraf exposes the underlying telegram client's options. The
            // agent option is typed loosely; a cast is the minimum-surface
            // way to inject it without widening Telegraf's type footprint.
            ;(this.bot.telegram.options as { agent?: unknown }).agent = this.opts.httpAgent
        }

        this.bot.on('text', (tgCtx) => this.handleText(tgCtx, ctx.dispatcher))

        // Fire-and-forget: telegraf .launch() polls forever.
        void this.bot.launch()
    }

    async stop(): Promise<void> {
        if (!this.bot) return
        try { this.bot.stop('shutdown') } catch { /* ignore */ }
        this.bot = null
    }

    private async handleText(tgCtx: Context, dispatcher: HubDispatcher): Promise<void> {
        const msg = tgCtx.message
        if (!msg || !('text' in msg) || !msg.text) return
        const text = msg.text.trim()
        if (!text.startsWith('/')) return

        const { command, args } = parseCommand(text)
        const userId = String(tgCtx.from?.id ?? 'anon')

        const lines: string[] = []
        const appendLine = (s: string) => lines.push(s)

        try {
            const result = await dispatcher.handle({
                command,
                args,
                userId,
                uiHandle: tgCtx,
                onEvent: (e: InvokeServer) => {
                    if (e.message !== undefined) appendLine(e.message.text)
                    else if (e.error !== undefined) appendLine(`⚠️ ${e.error.text}`)
                    else if (e.progressStatus !== undefined) {
                        appendLine(`[${e.progressStatus.name}] ${e.progressStatus.status}`)
                    }
                    // progress/intercom/file events silenced for the minimal adapter;
                    // a richer dashboard renderer can consume them later.
                },
            })
            const finalText = result.markup.text
            if (finalText) appendLine(finalText)
            const combined = lines.join('\n').slice(0, 4000) || '(no output)'
            await tgCtx.reply(combined)
        } catch (err) {
            await tgCtx.reply(`error: ${(err as Error).message}`)
        }
    }
}

/**
 * Parse "/scraper query=coffee city=Berlin" → { command: 'scraper', args: { query: 'coffee', city: 'Berlin' } }.
 * Positional args become arg0, arg1, … so built-ins like /node approve <id>
 * still work: /node approve abc → { sub: 'approve', id: 'abc' } when the
 * built-in reads its own positional conventions. For v1 the parser supports
 * three shapes:
 *    /cmd                         → {}
 *    /cmd sub arg                 → { sub, id: arg }  (matches /node built-in convention)
 *    /cmd k=v k2=v2               → { k, k2 }
 */
export function parseCommand(text: string): { command: string; args: Record<string, string> } {
    const stripped = text.replace(/^\//, '').trim()
    const parts = stripped.split(/\s+/).filter(Boolean)
    const command = parts.shift() ?? ''

    const args: Record<string, string> = {}
    const positional: string[] = []
    for (const part of parts) {
        const eq = part.indexOf('=')
        if (eq > 0) {
            args[part.slice(0, eq)] = part.slice(eq + 1)
        } else {
            positional.push(part)
        }
    }
    if (positional.length > 0 && !('sub' in args)) args.sub = positional[0]
    if (positional.length > 1 && !('id' in args)) args.id = positional[1]
    return { command, args }
}
