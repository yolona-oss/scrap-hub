import { randomUUID } from 'crypto'
import type {
    ICmdNodeClient,
    ManifestAggregator,
    CmdHubProto,
} from '@cmd-hub/transport'
import type { IUI, BaseUIContext } from '@cmd-hub/common'
import {
    decodePositionalName,
    isEncodedPositionalName,
    STANDALONE_ARG_VALUE,
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

        const sessionId = randomUUID()
        log.info(`RemoteCmdInvoker: /${input.command} → node "${pick.nodeId}" (session=${sessionId})`)
        const dashboard = this.deps.createDashboard({
            sessionId,
            userId: input.userId,
            uiHandle: input.uiHandle,
        })
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
            if (e.error !== undefined) {
                errored = true
                if (!finalText) finalText = e.error.text
            }
            if (e.done !== undefined) {
                sawDone = true
                finalText = e.done.finalMessage ?? ''
            }
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

    /** Legacy-signature shim that flattens `ICommandCompiled` into the
     *  bare-name args map the node expects (positional prefix stripped,
     *  standalone sentinel collapsed to ''). */
    async invokeLegacy<Ctx extends BaseUIContext>(
        userId: string,
        compiled: ICommandCompiled,
        ctx: Ctx,
        uiImpl: IUI<Ctx, unknown>,
    ): Promise<RemoteInvokeResult> {
        const args: Record<string, string> = {}
        for (const a of compiled.raw) {
            const name = isEncodedPositionalName(a.name)
                ? decodePositionalName(a.name).name
                : a.name
            args[name] = a.value === STANDALONE_ARG_VALUE ? '' : a.value
        }
        return this.invoke({
            command: compiled.command,
            args,
            userId,
            uiHandle: { ctx, uiImpl },
            uiName: uiImpl.ContextType(),
        })
    }
}

export function protoToDashboardEvent(e: InvokeServer): DashboardEvent | null {
    if (e.message !== undefined) return { kind: 'message', text: e.message.text }
    if (e.error !== undefined) return { kind: 'error', text: e.error.text }
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
    return null
}
