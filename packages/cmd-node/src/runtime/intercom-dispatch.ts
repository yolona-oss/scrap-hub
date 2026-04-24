import type { InvokeClient } from '@core/grpc/generated/cmd_node'

/**
 * Minimum shape the node runtime requires from a running service to route
 * reverse-channel messages into it. Matches the receiveMsg method on
 * BaseCommandService.
 */
export interface IntercomReceiver {
    receiveMsg(actionId: string, args: string[]): Promise<void>
}

/**
 * Unpack an InvokeClient message from the hub and route it into the service.
 * Intercom messages forward action id + args to receiveMsg; cancel forwards
 * a synthetic 'stop' action to preserve the monolith's pause/resume/stop
 * contract. start messages are consumed by the invoke server before this
 * dispatcher sees them and should never reach here.
 */
export async function dispatchIntercom(
    svc: IntercomReceiver,
    msg: InvokeClient,
): Promise<void> {
    if (msg.start !== undefined) {
        throw new Error('dispatchIntercom received an InvokeStart; handle it upstream')
    }
    if (msg.intercom !== undefined) {
        const { actionId, args } = msg.intercom
        await svc.receiveMsg(actionId, args ?? [])
        return
    }
    if (msg.cancel !== undefined) {
        await svc.receiveMsg('stop', [msg.cancel.reason ?? 'cancelled'])
        return
    }
    // Empty / unknown kind — no-op.
}
