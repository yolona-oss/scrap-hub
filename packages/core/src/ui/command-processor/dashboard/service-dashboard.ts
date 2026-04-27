import { BaseUIContext } from "../../../ui/types"
// Wider `@cmd-hub/common` IUI so callers don't re-narrow.
import type { IUI, UiMessage } from "@cmd-hub/common"
import { renderToText } from "@cmd-hub/common"
import { IMarkupButton } from "../types/markup"
import { UiUnicodeSymbols } from "../../../ui/ui-unicode-symbols"
import { ProgressTracker } from "./progress"
import { escapeHtml } from "@cmd-hub/common"
import log from "../../../application/logger"

const RENDER_DEBOUNCE_MS = 500
const MAX_MESSAGE_LENGTH = 4090 // Telegram limit is 4096, small margin for safety

export const DASHBOARD_CB_PREFIX = "svc_dash_"

export type DashboardEvent =
    | { kind: 'progress'; name: string; current: number; total: number }
    | { kind: 'progressStatus'; name: string; status: 'active' | 'done' | 'failed' | 'skipped' }
    | { kind: 'intercom'; actions: Array<{ id: string; label: string; icon: string }> }
    | { kind: 'file'; handle: unknown }
    | { kind: 'done'; finalMessage: string }
    | { kind: 'uiMessage'; message: UiMessage; compatibilityId: string; version: string }
    | { kind: 'liveLog'; lines: string[] }

export interface DashboardOptions {
    sendIntercom?: (actionId: string, args: string[]) => Promise<void> | void
    maxWidth?: number
    /** UI-specific UiMessage renderer. The hub wires this to the per-UI
     *  `UiMessageRendererRegistry` so each entry passes through the same
     *  render-half pipeline as live messages. Defaults to the framework's
     *  reference text renderer when omitted (test harnesses, dashboards
     *  attached without a UI registry). */
    renderUiMessage?: (msg: UiMessage) => string
}

export class ServiceDashboard<Ctx extends BaseUIContext = BaseUIContext> {
    /** Full UiMessage history for this session — ordered, never trimmed.
     *  Display-side `buildText()` head-truncates for the platform's
     *  message-size cap, but the underlying array retains everything so
     *  `/log` and resume-replay always see the complete record. */
    private readonly logEntries: UiMessage[] = []
    private messageId: string | null = null
    private userId: string
    private sessionId: string
    private maxWidth: number
    private dirty = false
    private renderTimer: ReturnType<typeof setTimeout> | null = null
    private attached = false
    private terminated = false

    public readonly progress = new ProgressTracker()
    private intercomActions: Array<{ id: string, label: string, icon?: string, args?: string[] }> = []

    /** Forwards button clicks back to the remote node. Wired by RemoteCmdInvoker. */
    public sendIntercom: (actionId: string, args: string[]) => Promise<void> | void

    /** UI-specific UiMessage renderer, set from DashboardOptions. */
    private readonly _renderUiMessage: (msg: UiMessage) => string

    constructor(
        private uiImpl: IUI<Ctx>,
        userId: string,
        sessionId: string,
        options: DashboardOptions = {},
    ) {
        this.userId = userId
        this.sessionId = sessionId
        this.maxWidth = options.maxWidth ?? uiImpl.max_message_width()
        this.sendIntercom = options.sendIntercom ?? (async () => { /* no-op */ })
        const uiName = uiImpl.ContextType()
        this._renderUiMessage = options.renderUiMessage
            ?? ((msg) => {
                const renderChild = (child: UiMessage): string =>
                    renderToText(child, { ui: uiName, depth: 1, render: renderChild })
                return renderToText(msg, {
                    ui: uiName,
                    depth: 0,
                    severity: msg.severity,
                    render: renderChild,
                })
            })
    }

    async attach(): Promise<void> {
        const text = `<pre>${this.buildText()}</pre>`
        const buttons = this.buildButtons()
        this.messageId = await this.uiImpl.sendMessage(this.userId, text, buttons, { parseMode: 'HTML' })
        this.attached = true
    }

    async detach(): Promise<void> {
        if (this.renderTimer) {
            clearTimeout(this.renderTimer)
            this.renderTimer = null
        }
        this.attached = false
        // Keep the message as a final state snapshot — don't delete.
        // Strip ctrl buttons via one final edit; `Service ended` line lands
        // outside the underlying log so it's clearly UI metadata.
        if (this.messageId) {
            try {
                const text = `<pre>${this.buildText()}\n${escapeHtml(UiUnicodeSymbols.info)} Service ended</pre>`
                await this.uiImpl.editMessage(this.userId, this.messageId, text, undefined, { parseMode: 'HTML' })
            } catch (_) {}
        }
    }

    /**
     * Delete the dashboard message (for explicit close or wipe_chat)
     */
    async destroy(): Promise<void> {
        await this.detach()
        if (this.messageId) {
            try {
                await this.uiImpl.deleteMessage(this.userId, this.messageId)
            } catch (_) {}
            this.messageId = null
        }
    }

    /**
     * Re-send dashboard as a new message (brings it to foreground).
     * Deletes the old message and creates a fresh one.
     */
    async reattach(): Promise<void> {
        if (this.messageId) {
            try {
                await this.uiImpl.deleteMessage(this.userId, this.messageId)
            } catch (_) {}
        }
        const text = `<pre>${this.buildText()}</pre>`
        const buttons = this.attached ? this.buildButtons() : []
        this.messageId = await this.uiImpl.sendMessage(this.userId, text, buttons, { parseMode: 'HTML' })
    }

    get isAttached() { return this.attached }

    get SessionId() { return this.sessionId }

    /** Read-only snapshot of the full log. Used by `/log` and tests; the
     *  on-disk repo is the canonical source of truth across restarts. */
    get log(): ReadonlyArray<UiMessage> {
        return this.logEntries
    }

    /**
     * Set progress bar value. Use dot notation for sub-progress:
     *   setProgress('scraping', 10, 100)
     *   setProgress('scraping.google', 5, 50)
     *   setProgress('scraping.avito', 5, 50)
     * Parent auto-aggregates from children if not explicitly set.
     */
    setProgress(name: string, current: number, total: number): void {
        this.progress.set(name, current, total)
        this.scheduleRender()
    }

    setProgressStatus(name: string, status: 'active' | 'done' | 'failed' | 'skipped'): void {
        this.progress.setStatus(name, status)
        this.scheduleRender()
    }

    removeProgress(name: string): void {
        this.progress.remove(name)
        this.scheduleRender()
    }

    clearProgress(): void {
        this.progress.clear()
        this.scheduleRender()
    }

    /**
     * Single event sink. Dispatches each DashboardEvent kind to the
     * internal state mutators. After a `done` event, subsequent calls
     * are dropped — the dashboard is terminal.
     */
    onEvent(e: DashboardEvent): void {
        if (this.terminated) return
        switch (e.kind) {
            case 'progress':
                this.setProgress(e.name, e.current, e.total)
                return
            case 'progressStatus':
                this.setProgressStatus(e.name, e.status)
                return
            case 'intercom':
                this.intercomActions = e.actions.map((a) => ({
                    id: a.id, label: a.label, icon: a.icon,
                }))
                this.scheduleRender()
                return
            case 'file':
                // Dashboard doesn't render files — handled by the caller,
                // typically the RemoteCmdInvoker or the UI layer.
                return
            case 'done':
                if (e.finalMessage) {
                    this.logEntries.push({ kind: 'text', text: e.finalMessage, severity: 'success' })
                }
                this.logEntries.push({
                    kind: 'text',
                    text: `${UiUnicodeSymbols.success} Service done`,
                    severity: 'success',
                })
                this.terminated = true
                // Fire-and-forget: render + detach. Do not await — onEvent is sync.
                void (async () => {
                    try { await this.renderNow() } catch (_) {}
                    try { await this.detach() } catch (_) {}
                })()
                return
            case 'uiMessage':
                this.logEntries.push(e.message)
                this.scheduleRender()
                return
            case 'liveLog':
                // Tool/agent breadcrumbs flow into the same log as text
                // entries with severity=info so the writer captures them
                // and the renderer can decide how to style them.
                for (const line of e.lines) {
                    this.logEntries.push({ kind: 'text', text: line, severity: 'info' })
                }
                this.scheduleRender()
                return
        }
    }

    async handleCallback(action: string): Promise<void> {
        if (action.startsWith('intercom_')) {
            const actionId = action.slice('intercom_'.length)
            const intercom = this.intercomActions.find(a => a.id === actionId)
            if (intercom) {
                try { await this.sendIntercom(actionId, intercom.args ?? []) } catch (_) {}
            }
        } else if (action === 'pause') {
            try { await this.sendIntercom('pause', []) } catch (_) {}
        } else if (action === 'resume') {
            try { await this.sendIntercom('resume', []) } catch (_) {}
        } else if (action === 'stop') {
            try { await this.sendIntercom('stop', []) } catch (_) {}
        }
    }

    private scheduleRender(): void {
        this.dirty = true
        if (this.renderTimer) return
        this.renderTimer = setTimeout(async () => {
            this.renderTimer = null
            if (this.dirty) {
                await this.renderNow()
            }
        }, RENDER_DEBOUNCE_MS)
    }

    async renderNow(): Promise<void> {
        if (!this.messageId || !this.attached) return
        this.dirty = false

        const text = `<pre>${this.buildText()}</pre>`
        const buttons = this.buildButtons()
        try {
            await this.uiImpl.editMessage(this.userId, this.messageId, text, buttons, { parseMode: 'HTML' })
        } catch (e: any) {
            log.debug(`Dashboard render failed: ${e.message ?? e}`)
        }
    }

    private truncateLine(line: string): string {
        return line.length > this.maxWidth - 2
            ? line.slice(0, this.maxWidth - 5) + '...'
            : line
    }

    private buildText(): string {
        const header = escapeHtml(`${UiUnicodeSymbols.gear} session: ${this.sessionId}`)
        const sep = '━'.repeat(Math.min(header.length, this.maxWidth))
        const fixedPart = `${header}\n${sep}\n`

        let body = ''
        let remaining = MAX_MESSAGE_LENGTH - fixedPart.length

        // Progress block — current snapshot, not part of the log.
        const progressText = this.progress.render(this.maxWidth)
        if (progressText) {
            const block = `${UiUnicodeSymbols.pending} progress:\n${progressText}\n`
            if (block.length < remaining) {
                body += block
                remaining -= block.length
            }
        }

        // Log block: render newest-last; head-truncate until everything fits.
        // Display-only truncation; `this.logEntries` retains everything for
        // `/log` retrieval and replay-on-resume. Reserve space upfront for
        // the truncation hint so it always lands when truncation happens.
        const HINT_RESERVE = 80  // upper bound on the dropNote line length
        const reservedRemaining = Math.max(0, remaining - HINT_RESERVE)
        // Walk newest→oldest pushing into a tail-collector with a running
        // length, then reverse once at the end. Avoids O(N²) unshift+reduce.
        const reversed: string[] = []
        let consumed = 0
        for (let i = this.logEntries.length - 1; i >= 0; i--) {
            const rendered = this._renderUiMessage(this.logEntries[i])
            const escaped = escapeHtml(this.truncateLine(rendered))
            const lineText = `  ${escaped}\n`
            const budget = reversed.length < this.logEntries.length - 1
                ? reservedRemaining
                : remaining
            if (consumed + lineText.length > budget) break
            reversed.push(lineText)
            consumed += lineText.length
        }
        const dropped = this.logEntries.length - reversed.length
        if (dropped > 0) {
            reversed.push(`  … ${dropped} older lines (use /log to see full history)\n`)
        }
        body += reversed.reverse().join('')

        return fixedPart + body
    }

    private buildButtons(): IMarkupButton[] {
        // Ctrl buttons — type 'value' → separate row group
        const ctrlButtons: IMarkupButton[] = [
            {
                text: `${UiUnicodeSymbols.pending} Pause`,
                type: 'value' as const,
                data: `${DASHBOARD_CB_PREFIX}pause`,
            },
            {
                text: `${UiUnicodeSymbols.cross} Stop`,
                type: 'value' as const,
                data: `${DASHBOARD_CB_PREFIX}stop`,
            },
        ]

        // Intercom buttons — type 'aux' → separate row group
        const intercomButtons: IMarkupButton[] = this.intercomActions.map(action => ({
            text: `${action.icon ?? UiUnicodeSymbols.hammer} ${action.label}`,
            type: 'aux' as const,
            data: `${DASHBOARD_CB_PREFIX}intercom_${action.id}`,
        }))

        return [...ctrlButtons, ...intercomButtons]
    }
}
