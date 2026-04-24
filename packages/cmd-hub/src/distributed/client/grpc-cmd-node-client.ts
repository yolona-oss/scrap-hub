import { EventEmitter } from 'events'
import {
    CmdNodeServiceClient,
    type InvokeClient,
    type InvokeServer,
    type InvokeStart,
} from '../../grpc/generated/cmd_node'
import type { ICmdNodeClient, InvocationHandle } from './cmd-node-client'

export interface NodeChannelResolver {
    /** Returns a gRPC channel/client for a given nodeId, or null if the node is not reachable. */
    getChannelFor(nodeId: string): CmdNodeServiceClient | null
}

/**
 * Real hub-side ICmdNodeClient. Uses a resolver (populated by the hub gRPC
 * server when nodes register via RegisterRequest.listen_address) to dial the
 * node's own gRPC server and open an Invoke bidi stream.
 */
export class GrpcCmdNodeClient implements ICmdNodeClient {
    constructor(private readonly resolver: NodeChannelResolver) {}

    async invoke(nodeId: string, start: InvokeStart): Promise<InvocationHandle> {
        const stub = this.resolver.getChannelFor(nodeId)
        if (!stub) throw new Error(`no gRPC channel available for node ${nodeId}`)

        const call = stub.invoke()
        const bus = new EventEmitter()
        const queue: InvokeServer[] = []
        let closed = false

        call.on('data', (msg: InvokeServer) => {
            queue.push(msg)
            bus.emit('event')
        })
        call.on('end', () => { closed = true; bus.emit('event') })
        call.on('error', (err) => {
            queue.push({ seq: 0, error: { text: (err as Error).message } })
            closed = true
            bus.emit('event')
        })

        call.write({ start } satisfies InvokeClient)

        return {
            sessionId: start.sessionId,
            async send(msg: InvokeClient): Promise<void> {
                call.write(msg)
            },
            async cancel(reason: string): Promise<void> {
                try {
                    call.write({ cancel: { reason } } satisfies InvokeClient)
                } catch { /* stream may already be closed */ }
                try { call.end() } catch { /* ignore */ }
            },
            async *events() {
                while (true) {
                    while (queue.length > 0) yield queue.shift()!
                    if (closed) return
                    await new Promise<void>((resolve) => bus.once('event', () => resolve()))
                }
            },
        }
    }
}

/**
 * Simple in-memory implementation of NodeChannelResolver. The hub registers
 * nodes into this resolver when they present a listen_address on Register,
 * and removes them when they disconnect.
 */
export class InMemoryChannelResolver implements NodeChannelResolver {
    private readonly channels = new Map<string, CmdNodeServiceClient>()

    constructor(private readonly makeClient: (addr: string) => CmdNodeServiceClient) {}

    attach(nodeId: string, listenAddress: string): void {
        const existing = this.channels.get(nodeId)
        if (existing) {
            try { existing.close() } catch { /* ignore */ }
        }
        this.channels.set(nodeId, this.makeClient(listenAddress))
    }

    detach(nodeId: string): void {
        const stub = this.channels.get(nodeId)
        if (stub) {
            try { stub.close() } catch { /* ignore */ }
            this.channels.delete(nodeId)
        }
    }

    getChannelFor(nodeId: string): CmdNodeServiceClient | null {
        return this.channels.get(nodeId) ?? null
    }

    clear(): void {
        for (const stub of this.channels.values()) {
            try { stub.close() } catch { /* ignore */ }
        }
        this.channels.clear()
    }
}
