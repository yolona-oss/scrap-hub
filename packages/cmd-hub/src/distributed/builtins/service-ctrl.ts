import type { BuiltInHandler } from '../dispatcher/hub-dispatcher'
import type { SessionIndex } from '../session/session-index'
import type { InvokeClient } from '../../grpc/generated/cmd_node'

export interface ServiceCtrlBuiltInDeps {
    sessions: SessionIndex
}

/**
 * /service-ctrl pause|resume|stop|terminate <sessionId>
 *
 * pause/resume/stop are sent as intercom messages to the running service —
 * the node's BaseCommandService.receiveMsg handles them. terminate explicitly
 * cancels the invocation stream.
 */
export function makeServiceCtrlBuiltIn(deps: ServiceCtrlBuiltInDeps): BuiltInHandler {
    const intercomActions = new Set(['pause', 'resume', 'stop', 'export'])

    return async (input) => {
        const sub = (input.args.sub ?? '').toLowerCase()
        const sessionId = input.args.id ?? input.args.sessionId ?? ''

        if (!sessionId) {
            return { success: false, markup: { text: 'usage: /service-ctrl <pause|resume|stop|terminate|export> <sessionId>' } }
        }
        const entry = deps.sessions.getBySession(sessionId)
        if (!entry) {
            return { success: false, markup: { text: `no active session: ${sessionId}` } }
        }

        if (sub === 'terminate') {
            await entry.handle.cancel(`terminated by user ${input.userId}`)
            deps.sessions.remove(sessionId)
            return { success: true, markup: { text: `terminated ${sessionId}` } }
        }

        if (intercomActions.has(sub)) {
            const msg: InvokeClient = { intercom: { actionId: sub, args: [] } }
            await entry.handle.send(msg)
            return { success: true, markup: { text: `${sub} sent to ${sessionId}` } }
        }

        return { success: false, markup: { text: `unknown action: ${sub}` } }
    }
}
