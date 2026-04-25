import { EventEmitter } from 'events'
import type { ICmdNodeClient, InvocationHandle } from './cmd-node-client'
import type { InvokeClient, InvokeServer, InvokeStart } from '../grpc/generated/cmd_node'

export type FakeHandler = (
    nodeId: string,
    start: InvokeStart,
    emit: (msg: InvokeServer) => void,
) => Promise<void>

/**
 * In-process fake for hub unit tests. The provided handler runs when invoke()
 * is called; any InvokeServer messages it emits are queued onto an iterator.
 */
export class FakeCmdNodeClient implements ICmdNodeClient {
    constructor(private readonly handler: FakeHandler) {}

    async invoke(nodeId: string, start: InvokeStart): Promise<InvocationHandle> {
        const bus = new EventEmitter()
        const queue: InvokeServer[] = []
        let closed = false

        const emit = (msg: InvokeServer) => {
            queue.push(msg)
            bus.emit('event')
        }

        void (async () => {
            try {
                await this.handler(nodeId, start, emit)
            } finally {
                closed = true
                bus.emit('event')
            }
        })()

        return {
            sessionId: start.sessionId,
            async send(_msg: InvokeClient): Promise<void> {
                // Fakes ignore reverse-channel messages by default.
            },
            async cancel(_reason: string): Promise<void> {
                closed = true
                bus.emit('event')
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
