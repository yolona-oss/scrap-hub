"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ServiceDashboard = exports.DASHBOARD_CB_PREFIX = void 0;
const ui_unicode_symbols_1 = require("../../../ui/ui-unicode-symbols");
const progress_1 = require("./progress");
const table_designer_1 = require("../../../utils/table-designer");
const logger_1 = __importDefault(require("../../../application/logger"));
const CHANNEL_ICONS = {
    message: ui_unicode_symbols_1.UiUnicodeSymbols.mail,
    error: ui_unicode_symbols_1.UiUnicodeSymbols.error,
    log: ui_unicode_symbols_1.UiUnicodeSymbols.magnifierGlass,
    progress: ui_unicode_symbols_1.UiUnicodeSymbols.pending,
    ctrl: ui_unicode_symbols_1.UiUnicodeSymbols.gear,
};
const CHANNEL_LABELS = {
    message: 'Msg',
    error: 'Err',
    log: 'Log',
    progress: 'Progress',
    ctrl: 'Ctrl',
};
const RENDER_DEBOUNCE_MS = 500;
const MAX_MESSAGE_LENGTH = 4090;
exports.DASHBOARD_CB_PREFIX = "svc_dash_";
class ServiceDashboard {
    uiImpl;
    channels;
    messageId = null;
    userId;
    sessionId;
    maxWidth;
    dirty = false;
    renderTimer = null;
    attached = false;
    terminated = false;
    progress = new progress_1.ProgressTracker();
    intercomActions = [];
    sendIntercom;
    constructor(uiImpl, userId, sessionId, options) {
        this.uiImpl = uiImpl;
        this.userId = userId;
        this.sessionId = sessionId;
        this.maxWidth = options?.maxWidth ?? uiImpl.max_message_width();
        this.sendIntercom = options?.sendIntercom ?? (async () => { });
        this.channels = new Map([
            ['message', { enabled: true, lines: [], maxLines: 0 }],
            ['error', { enabled: true, lines: [], maxLines: 0 }],
            ['log', { enabled: false, lines: [], maxLines: 0 }],
            ['progress', { enabled: true, lines: [], maxLines: 0 }],
            ['ctrl', { enabled: true, lines: [], maxLines: 0 }],
        ]);
    }
    async attach() {
        const text = `<pre>${this.buildText()}</pre>`;
        const buttons = this.buildButtons();
        this.messageId = await this.uiImpl.sendMessage(this.userId, text, buttons, { parseMode: 'HTML' });
        this.attached = true;
    }
    async detach() {
        if (this.renderTimer) {
            clearTimeout(this.renderTimer);
            this.renderTimer = null;
        }
        this.attached = false;
        if (this.messageId) {
            try {
                const text = `<pre>${this.buildText()}\n${(0, table_designer_1.escapeHtml)(ui_unicode_symbols_1.UiUnicodeSymbols.info)} Service ended</pre>`;
                await this.uiImpl.editMessage(this.userId, this.messageId, text, undefined, { parseMode: 'HTML' });
            }
            catch (_) { }
        }
    }
    async destroy() {
        await this.detach();
        if (this.messageId) {
            try {
                await this.uiImpl.deleteMessage(this.userId, this.messageId);
            }
            catch (_) { }
            this.messageId = null;
        }
    }
    async reattach() {
        if (this.messageId) {
            try {
                await this.uiImpl.deleteMessage(this.userId, this.messageId);
            }
            catch (_) { }
        }
        const text = `<pre>${this.buildText()}</pre>`;
        const buttons = this.attached ? this.buildButtons() : [];
        this.messageId = await this.uiImpl.sendMessage(this.userId, text, buttons, { parseMode: 'HTML' });
    }
    get isAttached() { return this.attached; }
    get SessionId() { return this.sessionId; }
    toggleChannel(name) {
        const ch = this.channels.get(name);
        if (ch && name !== 'ctrl') {
            ch.enabled = !ch.enabled;
            this.scheduleRender();
        }
    }
    setProgress(name, current, total) {
        this.progress.set(name, current, total);
        this.scheduleRender();
    }
    setProgressStatus(name, status) {
        this.progress.setStatus(name, status);
        this.scheduleRender();
    }
    removeProgress(name) {
        this.progress.remove(name);
        this.scheduleRender();
    }
    clearProgress() {
        this.progress.clear();
        this.scheduleRender();
    }
    appendLine(channel, line) {
        const ch = this.channels.get(channel);
        if (!ch)
            return;
        ch.lines.push(line);
        if (ch.maxLines > 0 && ch.lines.length > ch.maxLines) {
            ch.lines.splice(0, ch.lines.length - ch.maxLines);
        }
        this.scheduleRender();
    }
    onEvent(e) {
        if (this.terminated)
            return;
        switch (e.kind) {
            case 'message':
                this.appendLine('message', e.text);
                return;
            case 'error':
                this.appendLine('error', e.text);
                return;
            case 'progress':
                this.setProgress(e.name, e.current, e.total);
                return;
            case 'progressStatus':
                this.setProgressStatus(e.name, e.status);
                return;
            case 'intercom':
                this.intercomActions = e.actions.map((a) => ({
                    id: a.id, label: a.label, icon: a.icon,
                }));
                this.scheduleRender();
                return;
            case 'file':
                return;
            case 'done':
                if (e.finalMessage)
                    this.appendLine('message', e.finalMessage);
                this.appendLine('message', `${ui_unicode_symbols_1.UiUnicodeSymbols.success} Service done`);
                this.terminated = true;
                void (async () => {
                    try {
                        await this.renderNow();
                    }
                    catch (_) { }
                    try {
                        await this.detach();
                    }
                    catch (_) { }
                })();
                return;
        }
    }
    async handleCallback(action) {
        if (action.startsWith('toggle_')) {
            const channel = action.slice('toggle_'.length);
            this.toggleChannel(channel);
        }
        else if (action.startsWith('intercom_')) {
            const actionId = action.slice('intercom_'.length);
            const intercom = this.intercomActions.find(a => a.id === actionId);
            if (intercom) {
                try {
                    await this.sendIntercom(actionId, intercom.args ?? []);
                }
                catch (_) { }
            }
        }
        else if (action === 'pause') {
            try {
                await this.sendIntercom('pause', []);
            }
            catch (_) { }
        }
        else if (action === 'resume') {
            try {
                await this.sendIntercom('resume', []);
            }
            catch (_) { }
        }
        else if (action === 'stop') {
            try {
                await this.sendIntercom('stop', []);
            }
            catch (_) { }
        }
    }
    scheduleRender() {
        this.dirty = true;
        if (this.renderTimer)
            return;
        this.renderTimer = setTimeout(async () => {
            this.renderTimer = null;
            if (this.dirty) {
                await this.renderNow();
            }
        }, RENDER_DEBOUNCE_MS);
    }
    async renderNow() {
        if (!this.messageId || !this.attached)
            return;
        this.dirty = false;
        const text = `<pre>${this.buildText()}</pre>`;
        const buttons = this.buildButtons();
        try {
            await this.uiImpl.editMessage(this.userId, this.messageId, text, buttons, { parseMode: 'HTML' });
        }
        catch (e) {
            logger_1.default.debug(`Dashboard render failed: ${e.message ?? e}`);
        }
    }
    truncateLine(line) {
        return line.length > this.maxWidth - 2
            ? line.slice(0, this.maxWidth - 5) + '...'
            : line;
    }
    buildText() {
        const header = (0, table_designer_1.escapeHtml)(`${ui_unicode_symbols_1.UiUnicodeSymbols.gear} session: ${this.sessionId}`);
        const sep = '━'.repeat(Math.min(header.length, this.maxWidth));
        const fixedPart = `${header}\n${sep}\n`;
        const enabledChannels = ['progress', 'message', 'error', 'log'];
        const activeChannels = enabledChannels.filter(name => this.channels.get(name).enabled);
        let channelText = '';
        let remaining = MAX_MESSAGE_LENGTH - fixedPart.length;
        for (const name of activeChannels) {
            const icon = CHANNEL_ICONS[name];
            const label = CHANNEL_LABELS[name];
            const channelHeader = `${icon} ${label}:\n`;
            if (remaining <= channelHeader.length + 15)
                break;
            if (name === 'progress') {
                const progressText = this.progress.render(this.maxWidth);
                if (!progressText)
                    continue;
                const section = channelHeader + progressText;
                if (remaining - section.length < 0)
                    continue;
                channelText += section;
                remaining -= section.length;
                continue;
            }
            const ch = this.channels.get(name);
            channelText += channelHeader;
            remaining -= channelHeader.length;
            if (ch.lines.length === 0) {
                const emptyLine = `  (empty)\n`;
                channelText += emptyLine;
                remaining -= emptyLine.length;
            }
            else {
                const renderedLines = [];
                for (let i = ch.lines.length - 1; i >= 0; i--) {
                    const line = `  ${(0, table_designer_1.escapeHtml)(this.truncateLine(ch.lines[i]))}\n`;
                    if (remaining - line.length < 0)
                        break;
                    renderedLines.unshift(line);
                    remaining -= line.length;
                }
                const dropped = ch.lines.length - renderedLines.length;
                if (dropped > 0) {
                    const dropNote = `  ... ${dropped} older lines trimmed\n`;
                    channelText += dropNote;
                    remaining -= dropNote.length;
                }
                channelText += renderedLines.join('');
            }
        }
        return `${fixedPart}${channelText}`;
    }
    buildButtons() {
        const toggleButtons = ['progress', 'message', 'error', 'log'].map(name => {
            const ch = this.channels.get(name);
            const icon = CHANNEL_ICONS[name];
            const label = CHANNEL_LABELS[name];
            const status = ch.enabled ? ui_unicode_symbols_1.UiUnicodeSymbols.check : ui_unicode_symbols_1.UiUnicodeSymbols.cross;
            return {
                text: `${icon} ${label} ${status}`,
                type: 'name',
                data: `${exports.DASHBOARD_CB_PREFIX}toggle_${name}`,
            };
        });
        const ctrlButtons = [
            {
                text: `${ui_unicode_symbols_1.UiUnicodeSymbols.pending} Pause`,
                type: 'value',
                data: `${exports.DASHBOARD_CB_PREFIX}pause`,
            },
            {
                text: `${ui_unicode_symbols_1.UiUnicodeSymbols.cross} Stop`,
                type: 'value',
                data: `${exports.DASHBOARD_CB_PREFIX}stop`,
            },
        ];
        const intercomButtons = this.intercomActions.map(action => ({
            text: `${action.icon ?? ui_unicode_symbols_1.UiUnicodeSymbols.hammer} ${action.label}`,
            type: 'aux',
            data: `${exports.DASHBOARD_CB_PREFIX}intercom_${action.id}`,
        }));
        return [...toggleButtons, ...ctrlButtons, ...intercomButtons];
    }
}
exports.ServiceDashboard = ServiceDashboard;
