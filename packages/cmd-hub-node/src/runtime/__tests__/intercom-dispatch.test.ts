import { dispatchIntercom, IntercomReceiver } from '../intercom-dispatch'
import { CmdHubProto } from '@cmd-hub/transport'

function spyReceiver(): IntercomReceiver & { calls: Array<{ id: string; args: string[] }> } {
    const calls: Array<{ id: string; args: string[] }> = []
    return {
        calls,
        async receiveMsg(id, args) { calls.push({ id, args }) },
    }
}

describe('dispatchIntercom', () => {
    it('routes intercom action + args to receiveMsg', async () => {
        const svc = spyReceiver()
        const msg: CmdHubProto.InvokeClient = { intercom: { actionId: 'export', args: ['now'] } }
        await dispatchIntercom(svc, msg)
        expect(svc.calls).toEqual([{ id: 'export', args: ['now'] }])
    })

    it('routes cancel to a synthetic stop message', async () => {
        const svc = spyReceiver()
        await dispatchIntercom(svc, { cancel: { reason: 'user-requested' } })
        expect(svc.calls).toEqual([{ id: 'stop', args: ['user-requested'] }])
    })

    it('throws if an InvokeStart leaks through', async () => {
        const svc = spyReceiver()
        const msg: CmdHubProto.InvokeClient = {
            start: {
                sessionId: 's', userId: 'u', commandName: 'c',
                args: {}, serviceDataBlob: new Uint8Array(),
            },
        }
        await expect(dispatchIntercom(svc, msg)).rejects.toThrow(/InvokeStart/)
    })

    it('is a no-op for an empty message', async () => {
        const svc = spyReceiver()
        await dispatchIntercom(svc, {})
        expect(svc.calls).toEqual([])
    })
})
