import { EventEmitter } from 'events'
import { adaptService } from '../event-adapter'
import { CmdHubProto } from '@cmd-hub/core'

type InvokeServer = CmdHubProto.InvokeServer

describe('adaptService', () => {
    it('forwards every event type with a monotonic seq', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        const stop = adaptService(svc, (m) => out.push(m))

        svc.emit('message', 'hello')
        svc.emit('progress', 'src', 1, 10)
        svc.emit('progressStatus', 'src', 'active')
        svc.emit('intercom', [{ id: 'x', label: 'X', icon: '' }])
        svc.emit('error', 'bad')
        svc.emit('done', 'final')
        stop()

        expect(out).toHaveLength(6)
        expect(out[0].message?.text).toBe('hello')
        expect(out[1].progress).toEqual({ name: 'src', current: 1, total: 10 })
        expect(out[2].progressStatus).toEqual({ name: 'src', status: 'active' })
        expect(out[3].intercom?.actions?.[0].id).toBe('x')
        expect(out[4].error?.text).toBe('bad')
        expect(out[5].done?.finalMessage).toBe('final')

        expect(out.map((x) => x.seq)).toEqual([1, 2, 3, 4, 5, 6])
    })

    it('forwards file events carrying a FileHandle', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        adaptService(svc, (m) => out.push(m))
        const handle: CmdHubProto.FileHandle = {
            fileId: 'f1', backend: 'gridfs', size: 100,
            name: 'r.csv', mime: 'text/csv', permanent: false,
        }
        svc.emit('file', handle)
        expect(out[0].file?.handle?.fileId).toBe('f1')
    })

    it('surfaces a StreamError when a legacy path is emitted', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        adaptService(svc, (m) => out.push(m))
        svc.emit('file', '/tmp/some-file.csv')
        expect(out[0].error?.text).toMatch(/file-path event.*FileHandle/)
    })

    it('stop() detaches listeners and stops emitting', () => {
        const svc = new EventEmitter()
        const out: InvokeServer[] = []
        const stop = adaptService(svc, (m) => out.push(m))
        svc.emit('message', 'first')
        stop()
        svc.emit('message', 'second')
        expect(out).toHaveLength(1)
    })
})
