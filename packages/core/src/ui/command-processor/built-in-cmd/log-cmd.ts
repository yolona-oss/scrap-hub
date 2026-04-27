import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { CmdArgument } from "../../../ui/types/command"
import { UiUnicodeSymbols } from "../../../ui"
import {
    CAP_SessionLogRepo,
    renderToText,
    type UiMessage,
    type UiRenderContext,
} from "@cmd-hub/common"

class LogArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Session id (visible in the dashboard header during a run)",
    })
    sessionId!: string

    @CmdArgument({
        required: false,
        description: "Max entries to fetch (default 200)",
    })
    limit?: string

    @CmdArgument({
        required: false,
        description: "Starting seq for paging (default 0)",
    })
    fromSeq?: string
}

/** Reference render context for `/log` output. UIs that want to render
 *  with their own platform-specific renderers can override later — for
 *  v1, the text fallback is the same one every UI gets for free. */
function makeRenderCtx(uiName: string): UiRenderContext {
    const ctx: UiRenderContext = {
        ui: uiName,
        depth: 0,
        render: (child: UiMessage) => renderToText(child, ctx),
    }
    return ctx
}

export const LogCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.LOG,
    description: "Show full UiMessage history for a session.",
    args: new LogArgs,
    requires: [CAP_SessionLogRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx, uiImpl) {
        const repos = this.repos
        const repo = repos?.sessionLog
        if (!repo) {
            await ctx.reply(`${UiUnicodeSymbols.error} Session log storage not configured`)
            return
        }

        const sessionId = args.getOrThrow('sessionId')
        const rawLimit = args.get('limit')
        const limit = rawLimit ? Math.max(1, parseInt(rawLimit)) : 200
        const rawFromSeq = args.get('fromSeq')
        const fromSeq = rawFromSeq ? Math.max(0, parseInt(rawFromSeq)) : 0

        const entries = await repo.read(sessionId, { fromSeq, limit })
        if (entries.length === 0) {
            await ctx.reply(`${UiUnicodeSymbols.info} No log entries for session "${sessionId}"`)
            return
        }

        const renderCtx = makeRenderCtx(uiImpl?.ContextType?.() ?? 'unknown')
        const lines: string[] = []
        lines.push(`${UiUnicodeSymbols.gear} session "${sessionId}" — ${entries.length} entries${fromSeq > 0 ? ` (from seq ${fromSeq})` : ''}`)
        for (const entry of entries) {
            const msg = {
                kind: entry.kind,
                severity: entry.severity,
                ...entry.payload,
            } as unknown as UiMessage
            const rendered = renderToText(msg, renderCtx)
            const sevTag = entry.severity ? `[${entry.severity}] ` : ''
            lines.push(`#${entry.seq} ${sevTag}${rendered}`)
        }

        // Telegram-style 4096-char message cap; chunk into multiple replies.
        const MAX = 3500
        let chunk = ''
        for (const line of lines) {
            if (chunk.length + line.length + 1 > MAX) {
                await ctx.reply(chunk)
                chunk = ''
            }
            chunk = chunk ? `${chunk}\n${line}` : line
        }
        if (chunk) await ctx.reply(chunk)
    }
}
