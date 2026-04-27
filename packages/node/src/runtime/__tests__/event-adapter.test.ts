import { EventEmitter } from 'events'
import { NodeUiMessageRegistry, registerBuiltinBuilders } from '@cmd-hub/common'
import { adaptService } from '../event-adapter'
import { CmdHubProto } from '@cmd-hub/transport'

type InvokeServer = CmdHubProto.InvokeServer

/** Build a registry with all framework builtins; tests use this so the
 *  text/code paths look up successfully. */
function buildRegistry(): NodeUiMessageRegistry {
    const reg = new NodeUiMessageRegistry()
    registerBuiltinBuilders(reg)
    return reg
}

/** Decode a UiMessageEnvelope's payload back to a plain object. */
function decodePayload(env: CmdHubProto.UiMessageEnvelope | undefined): Record<string, unknown> | null {
    if (!env) return null
    return JSON.parse(Buffer.from(env.payloadJson).toString('utf8')) as Record<string, unknown>
}

describe('adaptService', () => {
    it('forwards every event type with a monotonic seq', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        const stop = adaptService(svc, (m) => out.push(m), buildRegistry())

        svc.emit('uiMessage', { kind: 'text', text: 'hello' })
        svc.emit('progress', 'src', 1, 10)
        svc.emit('progressStatus', 'src', 'active')
        svc.emit('intercom', [{ id: 'x', label: 'X', icon: '' }])
        svc.emit('uiMessage', { kind: 'text', text: 'bad', severity: 'error' })
        svc.emit('done', 'final')
        stop()

        expect(out).toHaveLength(6)
        expect(out[0].uiMessage?.kind).toBe('text')
        expect(decodePayload(out[0].uiMessage)).toEqual({ text: 'hello' })
        expect(out[0].uiMessage?.severity).toBe('')

        expect(out[1].progress).toEqual({ name: 'src', current: 1, total: 10 })
        expect(out[2].progressStatus).toEqual({ name: 'src', status: 'active' })
        expect(out[3].intercom?.actions?.[0].id).toBe('x')

        expect(out[4].uiMessage?.kind).toBe('text')
        expect(decodePayload(out[4].uiMessage)).toEqual({ text: 'bad' })
        expect(out[4].uiMessage?.severity).toBe('error')

        expect(out[5].done?.finalMessage).toBe('final')

        expect(out.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('forwards file events carrying a FileHandle', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        adaptService(svc, (m) => out.push(m), buildRegistry())
        const handle: CmdHubProto.FileHandle = {
            fileId: 'f1', backend: 'gridfs', size: 100,
            name: 'r.csv', mime: 'text/csv', permanent: false,
        }
        svc.emit('file', handle)
        expect(out[0].file?.handle?.fileId).toBe('f1')
    })

    it('rejects file events emitted with a string path (FileHandle required)', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        adaptService(svc, (m) => out.push(m), buildRegistry())
        svc.emit('file', '/tmp/some-file.csv')
        // The diagnostic rides the unified UiMessage channel as
        // severity=error so the dashboard treats it like any other
        // operator-visible failure.
        expect(out[0].uiMessage?.kind).toBe('text')
        expect(out[0].uiMessage?.severity).toBe('error')
        const payload = decodePayload(out[0].uiMessage) as { text: string }
        expect(payload.text).toMatch(/file-path event.*FileHandle/)
    })

    it('stop() detaches listeners and stops emitting', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        const stop = adaptService(svc, (m) => out.push(m), buildRegistry())
        svc.emit('uiMessage', { kind: 'text', text: 'first' })
        stop()
        svc.emit('uiMessage', { kind: 'text', text: 'second' })
        expect(out).toHaveLength(1)
    })

    it('defaults intercom actions to empty when emitted with no payload', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        adaptService(svc, (m) => out.push(m), buildRegistry())
        svc.emit('intercom', undefined as unknown as CmdHubProto.IntercomAction[])
        expect(out[0].intercom?.actions).toEqual([])
    })

    it('defaults done finalMessage to empty when omitted', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        adaptService(svc, (m) => out.push(m), buildRegistry())
        svc.emit('done')
        expect(out[0].done?.finalMessage).toBe('')
    })

    it('does not re-increment seq after stop()', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        const stop = adaptService(svc, (m) => out.push(m), buildRegistry())
        svc.emit('uiMessage', { kind: 'text', text: 'one' })
        svc.emit('uiMessage', { kind: 'text', text: 'two' })
        stop()
        expect(out.map((x) => x.seq)).toEqual([1, 2])
    })

    it('forwards uiMessage events as UiMessageEnvelope with compat metadata', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        adaptService(svc, (m) => out.push(m), buildRegistry())
        svc.emit('uiMessage', { kind: 'kv', pairs: [{ key: 'a', value: '1' }] })
        expect(out[0].uiMessage?.kind).toBe('kv')
        expect(out[0].uiMessage?.compatibilityId).toBe('cmd-hub.builtin.kv')
        expect(out[0].uiMessage?.version).toBe('1.0.0')
        expect(decodePayload(out[0].uiMessage)).toEqual({ pairs: [{ key: 'a', value: '1' }] })
    })

    it('surfaces unregistered uiMessage kinds as a text-fallback envelope', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        // Empty registry — no builders registered.
        adaptService(svc, (m) => out.push(m), new NodeUiMessageRegistry())
        svc.emit('uiMessage', { kind: 'org', name: 'x' } as unknown as { kind: 'text', text: string })
        expect(out[0].uiMessage?.kind).toBe('text')
        expect(out[0].uiMessage?.severity).toBe('warn')
        expect(decodePayload(out[0].uiMessage)).toEqual({ text: '[unregistered UiMessage kind: org]' })
    })

    it('forwards liveLog events', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        adaptService(svc, (m) => out.push(m), buildRegistry())
        svc.emit('liveLog', ['line a', 'line b'])
        expect(out[0].liveLog?.lines).toEqual(['line a', 'line b'])
    })

})
