import { randomUUID } from 'crypto'
import type {
    ICmdNodeClient,
    ManifestAggregator,
    CmdHubProto,
} from '@cmd-hub/transport'
import type {
    IUI,
    BaseUIContext,
    ISessionLogRepo,
    UiMessage,
} from '@cmd-hub/common'
import {
    SessionLogWriter,
    log,
} from '@cmd-hub/common'
import type { ICommandCompiled } from '../../ui/types/command'
import type { ServiceDashboard, DashboardEvent } from './dashboard/service-dashboard'

type InvokeServer = CmdHubProto.InvokeServer
type InvokeClient = CmdHubProto.InvokeClient

/** Per-invocation handle threaded UI → invoker → dashboard factory.
 *  `ctx` rides along opaquely for UI-specific dashboard narrowing. */
export interface UIHandle {
    ctx: unknown
    uiImpl: IUI<BaseUIContext, unknown>
}

export interface RemoteInvokeInput {
    command: string
    args: Record<string, string>
    userId: string
    uiHandle: UIHandle
    nodeOverride?: string
    /** When set, restricts node picks to those eligible for this UI. */
    uiName?: string
}

export interface RemoteInvokeResult {
    success: boolean
    markup: { text: string }
    messageType?: 'system' | 'builder' | 'dashboard' | 'result'
}

export interface DashboardSession {
    sessionId: string
    userId: string
    uiHandle: UIHandle
}

export type DashboardFactory = (session: DashboardSession) => ServiceDashboard<any>

export interface RemoteCmdInvokerDeps {
    aggregator: ManifestAggregator
    client: ICmdNodeClient
    createDashboard: DashboardFactory
    /** Optional. When present, every UiMessage seen on the wire is
     *  appended to this repo (batched) and existing entries are
     *  replayed to the dashboard before live events. Skip when no
     *  storage middleware is installed. */
    sessionLogRepo?: ISessionLogRepo
}

/** Fans /command out to a remote cmd-node over gRPC. Picks via the pool,
 *  spins up a ServiceDashboard, pipes InvokeServer events through it, and
 *  wires intercom clicks back. */
export class RemoteCmdInvoker {
    constructor(private readonly deps: RemoteCmdInvokerDeps) {}

    async invoke(input: RemoteInvokeInput): Promise<RemoteInvokeResult> {
        const pool = this.deps.aggregator.getPool()
        const pickOpts = input.nodeOverride
            ? { nodeId: input.nodeOverride }
            : input.uiName
                ? { uiName: input.uiName }
                : undefined
        const pick = pool.pick(input.command, pickOpts)
        if (!pick) {
            const reason = input.nodeOverride
                ? `node "${input.nodeOverride}" is not a peer for /${input.command}`
                : input.uiName
                    ? `no nodes eligible for /${input.command} from UI "${input.uiName}" — check federationRequires`
                    : `no nodes available for /${input.command}`
            log.warn(`RemoteCmdInvoker: ${reason}`)
            return { success: false, markup: { text: reason }, messageType: 'system' }
        }

        // If the caller passed an explicit session id (via `s=<id>` or
        // `sessionId=<id>`), reuse it — that's how replay-on-resume hooks
        // up to the persisted log. Otherwise generate a fresh UUID.
        const sessionId = (input.args.s || input.args.sessionId || randomUUID()).toString()
        const isResume = sessionId === input.args.s || sessionId === input.args.sessionId
        log.info(`RemoteCmdInvoker: /${input.command} → node "${pick.nodeId}" (session=${sessionId}${isResume ? ', resume' : ''})`)
        const dashboard = this.deps.createDashboard({
            sessionId,
            userId: input.userId,
            uiHandle: input.uiHandle,
        })

        // Wire the session log writer if a repo is available. Replay
        // existing entries to the dashboard BEFORE attach + before the
        // live event loop so the user sees historical state immediately.
        const writer = this.deps.sessionLogRepo
            ? new SessionLogWriter(this.deps.sessionLogRepo, sessionId)
            : null
        if (writer) await writer.seedSeqFromExisting()
        if (this.deps.sessionLogRepo && isResume) {
            try {
                const existing = await this.deps.sessionLogRepo.read(sessionId)
                for (const entry of existing) {
                    const msg = {
                        kind: entry.kind,
                        severity: entry.severity,
                        ...entry.payload,
                    } as unknown as UiMessage
                    dashboard.onEvent({
                        kind: 'uiMessage',
                        message: msg,
                        compatibilityId: entry.compatibilityId,
                        version: entry.version,
                    })
                }
                if (existing.length > 0) {
                    log.info(`RemoteCmdInvoker: replayed ${existing.length} log entries for session=${sessionId}`)
                }
            } catch (e) {
                log.warn(`RemoteCmdInvoker: replay failed for session=${sessionId}: ${(e as Error).message}`)
            }
        }

        await dashboard.attach()

        let handle: Awaited<ReturnType<ICmdNodeClient['invoke']>>
        try {
            handle = await this.deps.client.invoke(pick.nodeId, {
                sessionId,
                userId: input.userId,
                commandName: input.command,
                args: input.args,
                serviceDataBlob: new Uint8Array(),
            })
        } catch (e) {
            log.error(`RemoteCmdInvoker: /${input.command} on "${pick.nodeId}" failed to open: ${(e as Error)?.message ?? e}`)
            try { await dashboard.detach() } catch { /* ignore */ }
            return {
                success: false,
                markup: { text: `invocation failed: ${(e as Error).message}` },
                messageType: 'system',
            }
        }

        dashboard.sendIntercom = async (actionId, args) => {
            const msg: InvokeClient = { intercom: { actionId, args } }
            await handle.send(msg)
        }

        let finalText = ''
        let errored = false
        let sawDone = false
        for await (const e of handle.events()) {
            const dashEvent = protoToDashboardEvent(e)
            if (dashEvent) dashboard.onEvent(dashEvent)

            // Persist UiMessages to the session log (batched via writer).
            // Use the wire envelope's compatibilityId/version directly —
            // they're already present, no registry lookup needed.
            if (writer && dashEvent?.kind === 'uiMessage') {
                writer.record(dashEvent.message, {
                    compatibilityId: dashEvent.compatibilityId,
                    version: dashEvent.version,
                })
            }

            // Track terminal failure: any error-severity UiMessage marks
            // the run as errored so the post-stream finalize state knows
            // to flag the failure even if `done` is missing.
            if (e.uiMessage?.severity === 'error') {
                errored = true
                if (!finalText) {
                    try {
                        const parsed = JSON.parse(Buffer.from(e.uiMessage.payloadJson).toString('utf8')) as { text?: string }
                        finalText = parsed.text ?? ''
                    } catch {
                        finalText = `[malformed envelope: kind=${e.uiMessage.kind}]`
                    }
                }
            }
            if (e.done !== undefined) {
                sawDone = true
                finalText = e.done.finalMessage ?? ''
            }
        }
        // Final flush so the trailing batch lands. Always close, even on
        // error paths, so the buffer doesn't stay around.
        if (writer) {
            try { await writer.close() } catch { /* logged inside */ }
        }
        // Stream closed without `done` (node crash/disconnect): force terminal state.
        if (!sawDone) {
            try { await dashboard.detach() } catch { /* ignore */ }
        }

        if (errored) {
            return {
                success: false,
                markup: { text: finalText || 'command failed' },
                messageType: 'dashboard',
            }
        }
        return { success: true, markup: { text: finalText }, messageType: 'dashboard' }
    }

    /** Convenience overload: hand the invoker a compiled-builder result
     *  and it ships `compiled.raw` (the slash-delimited dot-path map)
     *  straight as the proto `args` map. */
    async invokeLegacy<Ctx extends BaseUIContext>(
        userId: string,
        compiled: ICommandCompiled,
        ctx: Ctx,
        uiImpl: IUI<Ctx, unknown>,
    ): Promise<RemoteInvokeResult> {
        return this.invoke({
            command: compiled.command,
            args: Object.fromEntries(compiled.raw),
            userId,
            uiHandle: { ctx, uiImpl },
            uiName: uiImpl.ContextType(),
        })
    }
}

export function protoToDashboardEvent(e: InvokeServer): DashboardEvent | null {
    if (e.progress !== undefined) {
        return {
            kind: 'progress',
            name: e.progress.name,
            current: Number(e.progress.current),
            total: Number(e.progress.total),
        }
    }
    if (e.progressStatus !== undefined) {
        return {
            kind: 'progressStatus',
            name: e.progressStatus.name,
            status: e.progressStatus.status as 'active' | 'done' | 'failed' | 'skipped',
        }
    }
    if (e.intercom !== undefined) {
        return {
            kind: 'intercom',
            actions: e.intercom.actions.map((a) => ({
                id: a.id, label: a.label, icon: a.icon,
            })),
        }
    }
    if (e.file !== undefined && e.file.handle) {
        return { kind: 'file', handle: e.file.handle }
    }
    if (e.done !== undefined) {
        return { kind: 'done', finalMessage: e.done.finalMessage ?? '' }
    }
    if (e.uiMessage !== undefined) {
        const env = e.uiMessage
        let payload: Record<string, unknown> = {}
        try {
            const text = Buffer.from(env.payloadJson).toString('utf8')
            payload = text ? JSON.parse(text) : {}
        } catch {
            // Malformed payload — surface as text fallback.
            return {
                kind: 'uiMessage',
                message: { kind: 'text', text: `[malformed UiMessage envelope: kind=${env.kind}]`, severity: 'error' } as import('@cmd-hub/common').UiMessage,
                compatibilityId: env.compatibilityId,
                version: env.version,
            }
        }
        const severity = env.severity ? (env.severity as import('@cmd-hub/common').UiSeverity) : undefined
        const message = { kind: env.kind, severity, ...payload } as unknown as import('@cmd-hub/common').UiMessage
        return {
            kind: 'uiMessage',
            message,
            compatibilityId: env.compatibilityId,
            version: env.version,
        }
    }
    if (e.liveLog !== undefined) {
        return { kind: 'liveLog', lines: e.liveLog.lines ?? [] }
    }
    return null
}
