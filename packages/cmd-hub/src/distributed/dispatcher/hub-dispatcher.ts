import { randomUUID } from 'crypto'
import type { InvokeServer } from '../../grpc/generated/cmd_node'
import type { ICmdNodeClient } from '../client/cmd-node-client'
import type { ManifestAggregator } from '../pool/manifest-aggregator'

export interface HandleInput {
    command: string
    args: Record<string, string>
    userId: string
    uiHandle: unknown
    nodeOverride?: string
    onEvent?: (e: InvokeServer) => void
}

export interface HandleResult {
    success: boolean
    markup: { text: string }
    messageType?: 'system' | 'builder' | 'dashboard' | 'result'
}

export type BuiltInHandler = (input: HandleInput) => Promise<HandleResult>

/**
 * Hub-side dispatcher. Built-ins always win over pool commands on name collision.
 * Pool routing uses round-robin unless the caller passes a nodeOverride.
 */
export class HubDispatcher {
    private readonly builtIns = new Map<string, BuiltInHandler>()

    constructor(private readonly deps: {
        aggregator: ManifestAggregator
        client: ICmdNodeClient
    }) {}

    registerBuiltIn(name: string, handler: BuiltInHandler): void {
        if (this.builtIns.has(name)) throw new Error(`built-in already registered: ${name}`)
        this.builtIns.set(name, handler)
    }

    builtInNames(): string[] {
        return [...this.builtIns.keys()].sort()
    }

    async handle(input: HandleInput): Promise<HandleResult> {
        const bi = this.builtIns.get(input.command)
        if (bi) return bi(input)

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

        const handle = await this.deps.client.invoke(pick.nodeId, {
            sessionId: randomUUID(),
            userId: input.userId,
            commandName: input.command,
            args: input.args,
            serviceDataBlob: new Uint8Array(),
        })

        let finalText = ''
        let errored = false
        for await (const e of handle.events()) {
            input.onEvent?.(e)
            if (e.error !== undefined) errored = true
            if (e.done !== undefined) finalText = e.done.finalMessage ?? ''
        }

        if (errored) {
            return { success: false, markup: { text: finalText || 'command failed' }, messageType: 'dashboard' }
        }
        return { success: true, markup: { text: finalText }, messageType: 'dashboard' }
    }
}
