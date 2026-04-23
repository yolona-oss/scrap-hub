import { makeServiceCtrlBuiltIn } from '../service-ctrl'
import { SessionIndex } from '../../session/session-index'
import type { SessionContext } from '../../types'
import type { InvocationHandle } from '../../client/cmd-node-client'
import type { InvokeClient } from '../../../grpc/generated/cmd_node'

const ctx = (sessionId: string, userId: string): SessionContext => ({
    sessionId, userId, command: 'scraper', nodeId: 'N1',
    startedAt: Date.now(), uiHandle: null,
})

function recordingHandle(sessionId: string) {
    const sent: InvokeClient[] = []
    let cancelledReason: string | null = null
    const handle: InvocationHandle = {
        sessionId,
        async send(msg) { sent.push(msg) },
        async cancel(reason) { cancelledReason = reason },
        async *events() {},
    }
    return { handle, sent, get cancelledReason() { return cancelledReason } }
}

describe('/service-ctrl built-in', () => {
    it('sends an intercom message for pause', async () => {
        const sessions = new SessionIndex()
        const rh = recordingHandle('s1')
        sessions.register(ctx('s1', 'alice'), rh.handle)
        const h = makeServiceCtrlBuiltIn({ sessions })

        const r = await h({ command: 'service-ctrl', args: { sub: 'pause', id: 's1' }, userId: 'alice', uiHandle: null })
        expect(r.success).toBe(true)
        expect(rh.sent).toHaveLength(1)
        expect(rh.sent[0].intercom?.actionId).toBe('pause')
    })

    it('cancels the handle on terminate and removes the session', async () => {
        const sessions = new SessionIndex()
        const rh = recordingHandle('s2')
        sessions.register(ctx('s2', 'bob'), rh.handle)
        const h = makeServiceCtrlBuiltIn({ sessions })

        const r = await h({ command: 'service-ctrl', args: { sub: 'terminate', id: 's2' }, userId: 'bob', uiHandle: null })
        expect(r.success).toBe(true)
        expect(rh.cancelledReason).toMatch(/bob/)
        expect(sessions.getBySession('s2')).toBeNull()
    })

    it('fails clearly for unknown session', async () => {
        const h = makeServiceCtrlBuiltIn({ sessions: new SessionIndex() })
        const r = await h({ command: 'service-ctrl', args: { sub: 'pause', id: 'zzz' }, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/no active session/)
    })

    it('fails clearly for unknown action', async () => {
        const sessions = new SessionIndex()
        sessions.register(ctx('s3', 'u'), recordingHandle('s3').handle)
        const h = makeServiceCtrlBuiltIn({ sessions })

        const r = await h({ command: 'service-ctrl', args: { sub: 'wiggle', id: 's3' }, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/unknown action/)
    })

    it('fails clearly when sessionId is missing', async () => {
        const h = makeServiceCtrlBuiltIn({ sessions: new SessionIndex() })
        const r = await h({ command: 'service-ctrl', args: { sub: 'pause' }, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/usage/)
    })
})
