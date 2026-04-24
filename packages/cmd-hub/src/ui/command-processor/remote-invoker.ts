import { randomUUID } from 'crypto'
import type {
    ICmdNodeClient,
    ManifestAggregator,
    CmdHubProto,
} from '@cmd-hub/transport'
import type { IUI, BaseUIContext } from '@cmd-hub/common'
import type { ICommandCompiled } from '../../ui/types/command'
import type { ServiceDashboard, DashboardEvent } from './dashboard/service-dashboard'

type InvokeServer = CmdHubProto.InvokeServer
type InvokeClient = CmdHubProto.InvokeClient

export interface RemoteInvokeInput {
    command: string
    args: Record<string, string>
    userId: string
    uiHandle: unknown
    nodeOverride?: string
}

export interface RemoteInvokeResult {
    success: boolean
    markup: { text: string }
    messageType?: 'system' | 'builder' | 'dashboard' | 'result'
}

export interface DashboardSession {
    sessionId: string
    userId: string
    uiHandle: unknown
}

export type DashboardFactory = (session: DashboardSession) => ServiceDashboard<any>

export interface RemoteCmdInvokerDeps {
    aggregator: ManifestAggregator
    client: ICmdNodeClient
    createDashboard: DashboardFactory
}

/**
 * Hub-side invoker that fans an incoming /command out to a remote cmd-node
 * via gRPC. Replaces the legacy in-process CommandInvoker. Each invocation:
 *
 *   1. Picks a node from ManifestAggregator's CommandPool (round-robin or
 *      a caller-supplied nodeOverride).
 *   2. Creates a ServiceDashboard via the injected factory.
 *   3. Opens a gRPC Invoke stream via ICmdNodeClient.
 *   4. Pipes the node's InvokeServer events through protoToDashboardEvent()
 *      into dashboard.onEvent().
 *   5. Wires dashboard.sendIntercom -> handle.send({ intercom }) so button
 *      clicks reach the node.
 */
export class RemoteCmdInvoker {
    constructor(private readonly deps: RemoteCmdInvokerDeps) {}

    /**
     * New-shape invocation. The `args` map is passed straight through as the
     * gRPC InvokeStart.args field.
     */
    async invoke(input: RemoteInvokeInput): Promise<RemoteInvokeResult> {
        const pool = this.deps.aggregator.getPool()
        const pick = pool.pick(
            input.command,
            input.nodeOverride ? { nodeId: input.nodeOverride } : undefined,
        )
        if (!pick) {
            const reason = input.nodeOverride
                ? `node "${input.nodeOverride}" is not a peer for /${input.command}`
                : `no nodes available for /${input.command}`
            return { success: false, markup: { text: reason }, messageType: 'system' }
        }

        const sessionId = randomUUID()
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
            try { await dashboard.detach() } catch { /* ignore */ }
            return {
                success: false,
                markup: { text: `invocation failed: ${(e as Error).message}` },
                messageType: 'system',
            }
        }

        // Wire dashboard intercom clicks back to the node.
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
        // Stream closed without a done event (node crash, disconnect).
        // Detach the dashboard explicitly so its message reaches a terminal
        // state — onEvent doesn't fire because there's no `done` proto.
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

    /**
     * Legacy-signature shim. Callers in cmd-hub still pass
     *   (userId, ICommandCompiled, ctx, uiImpl)
     * — flatten the compiled argument list into a plain Record<string,string>
     * and delegate to invoke().
     */
    async invokeLegacy<Ctx extends BaseUIContext>(
        userId: string,
        compiled: ICommandCompiled,
        ctx: Ctx,
        uiImpl: IUI<Ctx, unknown>,
    ): Promise<RemoteInvokeResult> {
        const args: Record<string, string> = {}
        for (const a of compiled.raw) {
            args[a.name] = a.value
        }
        return this.invoke({
            command: compiled.command,
            args,
            userId,
            uiHandle: { ctx, uiImpl },
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
