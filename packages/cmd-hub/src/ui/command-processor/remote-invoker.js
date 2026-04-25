"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteCmdInvoker = void 0;
exports.protoToDashboardEvent = protoToDashboardEvent;
const crypto_1 = require("crypto");
class RemoteCmdInvoker {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async invoke(input) {
        const pool = this.deps.aggregator.getPool();
        const pickOpts = input.nodeOverride
            ? { nodeId: input.nodeOverride }
            : input.uiName
                ? { uiName: input.uiName }
                : undefined;
        const pick = pool.pick(input.command, pickOpts);
        if (!pick) {
            const reason = input.nodeOverride
                ? `node "${input.nodeOverride}" is not a peer for /${input.command}`
                : input.uiName
                    ? `no nodes eligible for /${input.command} from UI "${input.uiName}" — check federationRequires`
                    : `no nodes available for /${input.command}`;
            return { success: false, markup: { text: reason }, messageType: 'system' };
        }
        const sessionId = (0, crypto_1.randomUUID)();
        const dashboard = this.deps.createDashboard({
            sessionId,
            userId: input.userId,
            uiHandle: input.uiHandle,
        });
        await dashboard.attach();
        let handle;
        try {
            handle = await this.deps.client.invoke(pick.nodeId, {
                sessionId,
                userId: input.userId,
                commandName: input.command,
                args: input.args,
                serviceDataBlob: new Uint8Array(),
            });
        }
        catch (e) {
            try {
                await dashboard.detach();
            }
            catch { }
            return {
                success: false,
                markup: { text: `invocation failed: ${e.message}` },
                messageType: 'system',
            };
        }
        dashboard.sendIntercom = async (actionId, args) => {
            const msg = { intercom: { actionId, args } };
            await handle.send(msg);
        };
        let finalText = '';
        let errored = false;
        let sawDone = false;
        for await (const e of handle.events()) {
            const dashEvent = protoToDashboardEvent(e);
            if (dashEvent)
                dashboard.onEvent(dashEvent);
            if (e.error !== undefined) {
                errored = true;
                if (!finalText)
                    finalText = e.error.text;
            }
            if (e.done !== undefined) {
                sawDone = true;
                finalText = e.done.finalMessage ?? '';
            }
        }
        if (!sawDone) {
            try {
                await dashboard.detach();
            }
            catch { }
        }
        if (errored) {
            return {
                success: false,
                markup: { text: finalText || 'command failed' },
                messageType: 'dashboard',
            };
        }
        return { success: true, markup: { text: finalText }, messageType: 'dashboard' };
    }
    async invokeLegacy(userId, compiled, ctx, uiImpl) {
        const args = {};
        for (const a of compiled.raw) {
            args[a.name] = a.value;
        }
        return this.invoke({
            command: compiled.command,
            args,
            userId,
            uiHandle: { ctx, uiImpl },
            uiName: uiImpl.ContextType(),
        });
    }
}
exports.RemoteCmdInvoker = RemoteCmdInvoker;
function protoToDashboardEvent(e) {
    if (e.message !== undefined)
        return { kind: 'message', text: e.message.text };
    if (e.error !== undefined)
        return { kind: 'error', text: e.error.text };
    if (e.progress !== undefined) {
        return {
            kind: 'progress',
            name: e.progress.name,
            current: Number(e.progress.current),
            total: Number(e.progress.total),
        };
    }
    if (e.progressStatus !== undefined) {
        return {
            kind: 'progressStatus',
            name: e.progressStatus.name,
            status: e.progressStatus.status,
        };
    }
    if (e.intercom !== undefined) {
        return {
            kind: 'intercom',
            actions: e.intercom.actions.map((a) => ({
                id: a.id, label: a.label, icon: a.icon,
            })),
        };
    }
    if (e.file !== undefined && e.file.handle) {
        return { kind: 'file', handle: e.file.handle };
    }
    if (e.done !== undefined) {
        return { kind: 'done', finalMessage: e.done.finalMessage ?? '' };
    }
    return null;
}
