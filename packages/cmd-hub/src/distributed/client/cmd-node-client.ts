import type { InvokeClient, InvokeServer, InvokeStart } from '../../grpc/generated/cmd_node'

export interface InvocationHandle {
    readonly sessionId: string
    /** Send a reverse-channel message to the node (intercom, cancel). */
    send(msg: InvokeClient): Promise<void>
    /** Async iterator of InvokeServer events produced by the node. */
    events(): AsyncIterable<InvokeServer>
    /** Explicit cancel — equivalent to send({ cancel: { reason } }) + close. */
    cancel(reason: string): Promise<void>
}

export interface ICmdNodeClient {
    invoke(nodeId: string, start: InvokeStart): Promise<InvocationHandle>
}
