import { BaseUIContext } from "../../../ui/types"
// Wider `@cmd-hub/common` IUI so callers don't re-narrow.
import type { IUI } from "@cmd-hub/common"
import { IMarkupButton } from "../types/markup"
import { UiUnicodeSymbols } from "../../../ui/ui-unicode-symbols"
import { ProgressTracker } from "./progress"
import { escapeHtml } from "@cmd-hub/common"
import log from "../../../application/logger"

export type ChannelName = 'message' | 'error' | 'log' | 'progress' | 'ctrl'

const CHANNEL_ICONS: Record<ChannelName, string> = {
    message: UiUnicodeSymbols.mail,
    error: UiUnicodeSymbols.error,
    log: UiUnicodeSymbols.magnifierGlass,
    progress: UiUnicodeSymbols.pending,
    ctrl: UiUnicodeSymbols.gear,
}

const CHANNEL_LABELS: Record<ChannelName, string> = {
    message: 'Msg',
    error: 'Err',
    log: 'Log',
    progress: 'Progress',
    ctrl: 'Ctrl',
}

interface DashboardChannel {
    enabled: boolean
    lines: string[]
    maxLines: number
}

const RENDER_DEBOUNCE_MS = 500
const MAX_MESSAGE_LENGTH = 4090 // Telegram limit is 4096, small margin for safety

export const DASHBOARD_CB_PREFIX = "svc_dash_"

export type DashboardEvent =
    | { kind: 'message'; text: string }
    | { kind: 'error'; text: string }
    | { kind: 'progress'; name: string; current: number; total: number }
    | { kind: 'progressStatus'; name: string; status: 'active' | 'done' | 'failed' | 'skipped' }
    | { kind: 'intercom'; actions: Array<{ id: string; label: string; icon: string }> }
    | { kind: 'file'; handle: unknown }
    | { kind: 'done'; finalMessage: string }

export interface DashboardOptions {
    sendIntercom?: (actionId: string, args: string[]) => Promise<void> | void
    maxWidth?: number
}

export class ServiceDashboard<Ctx extends BaseUIContext = BaseUIContext> {
    private channels: Map<ChannelName, DashboardChannel>
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

    constructor(
        private uiImpl: IUI<Ctx>,
        userId: string,
        sessionId: string,
        options?: DashboardOptions,
    ) {
        this.userId = userId
        this.sessionId = sessionId
        this.maxWidth = options?.maxWidth ?? uiImpl.max_message_width()
        this.sendIntercom = options?.sendIntercom ?? (async () => { /* no-op */ })
        this.channels = new Map([
            ['message',  { enabled: true, lines: [], maxLines: 0 }],
            ['error',    { enabled: true, lines: [], maxLines: 0 }],
            ['log',      { enabled: false, lines: [], maxLines: 0 }],
            ['progress', { enabled: true, lines: [], maxLines: 0 }],
            ['ctrl',     { enabled: true, lines: [], maxLines: 0 }],
        ])
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
        // Keep the message as a final state snapshot — don't delete
        // Remove buttons by doing a final render without ctrl buttons
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
        // Delete old message if exists
        if (this.messageId) {
            try {
                await this.uiImpl.deleteMessage(this.userId, this.messageId)
            } catch (_) {}
        }
        // Send new message
        const text = `<pre>${this.buildText()}</pre>`
        const buttons = this.attached ? this.buildButtons() : []
        this.messageId = await this.uiImpl.sendMessage(this.userId, text, buttons, { parseMode: 'HTML' })
    }

    get isAttached() { return this.attached }

    get SessionId() { return this.sessionId }

    toggleChannel(name: ChannelName): void {
        const ch = this.channels.get(name)
        if (ch && name !== 'ctrl') {
            ch.enabled = !ch.enabled
            this.scheduleRender()
        }
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

    appendLine(channel: ChannelName, line: string): void {
        const ch = this.channels.get(channel)
        if (!ch) return
        ch.lines.push(line)
        // Trim to rolling window
        if (ch.maxLines > 0 && ch.lines.length > ch.maxLines) {
            ch.lines.splice(0, ch.lines.length - ch.maxLines)
        }
        this.scheduleRender()
    }

    /**
     * Single event sink. Dispatches each DashboardEvent kind to the
     * existing internal state mutators. After a `done` event, subsequent
     * calls are dropped — the dashboard is terminal.
     */
    onEvent(e: DashboardEvent): void {
        if (this.terminated) return
        switch (e.kind) {
            case 'message':
                this.appendLine('message', e.text)
                return
            case 'error':
                this.appendLine('error', e.text)
                return
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
                if (e.finalMessage) this.appendLine('message', e.finalMessage)
                this.appendLine('message', `${UiUnicodeSymbols.success} Service done`)
                this.terminated = true
                // Fire-and-forget: render + detach. Do not await — onEvent is sync.
                void (async () => {
                    try { await this.renderNow() } catch (_) {}
                    try { await this.detach() } catch (_) {}
                })()
                return
        }
    }

    async handleCallback(action: string): Promise<void> {
        if (action.startsWith('toggle_')) {
            const channel = action.slice('toggle_'.length) as ChannelName
            this.toggleChannel(channel)
        } else if (action.startsWith('intercom_')) {
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

        // All togglable channels including progress
        const enabledChannels: ChannelName[] = ['progress', 'message', 'error', 'log']
        const activeChannels = enabledChannels.filter(name => this.channels.get(name)!.enabled)

        let channelText = ''
        let remaining = MAX_MESSAGE_LENGTH - fixedPart.length

        for (const name of activeChannels) {
            const icon = CHANNEL_ICONS[name]
            const label = CHANNEL_LABELS[name]
            const channelHeader = `${icon} ${label}:\n`

            if (remaining <= channelHeader.length + 15) break

            // Progress channel: render from progress tracker, not lines
            if (name === 'progress') {
                const progressText = this.progress.render(this.maxWidth)
                if (!progressText) continue
                const section = channelHeader + progressText
                if (remaining - section.length < 0) continue
                channelText += section
                remaining -= section.length
                continue
            }

            const ch = this.channels.get(name)!
            channelText += channelHeader
            remaining -= channelHeader.length

            if (ch.lines.length === 0) {
                const emptyLine = `  (empty)\n`
                channelText += emptyLine
                remaining -= emptyLine.length
            } else {
                const renderedLines: string[] = []
                for (let i = ch.lines.length - 1; i >= 0; i--) {
                    const line = `  ${escapeHtml(this.truncateLine(ch.lines[i]))}\n`
                    if (remaining - line.length < 0) break
                    renderedLines.unshift(line)
                    remaining -= line.length
                }

                const dropped = ch.lines.length - renderedLines.length
                if (dropped > 0) {
                    const dropNote = `  ... ${dropped} older lines trimmed\n`
                    channelText += dropNote
                    remaining -= dropNote.length
                }

                channelText += renderedLines.join('')
            }
        }

        return `${fixedPart}${channelText}`
    }

    private buildButtons(): IMarkupButton[] {
        // Toggle buttons — type 'name' → own row group
        const toggleButtons: IMarkupButton[] = (['progress', 'message', 'error', 'log'] as ChannelName[]).map(name => {
            const ch = this.channels.get(name)!
            const icon = CHANNEL_ICONS[name]
            const label = CHANNEL_LABELS[name]
            const status = ch.enabled ? UiUnicodeSymbols.check : UiUnicodeSymbols.cross
            return {
                text: `${icon} ${label} ${status}`,
                type: 'name' as const,
                data: `${DASHBOARD_CB_PREFIX}toggle_${name}`,
            }
        })

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

        return [...toggleButtons, ...ctrlButtons, ...intercomButtons]
    }
}
