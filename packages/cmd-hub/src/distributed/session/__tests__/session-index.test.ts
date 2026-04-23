import { SessionIndex } from '../session-index'
import type { SessionContext } from '../../types'
import type { InvocationHandle } from '../../client/cmd-node-client'

const ctx = (sessionId: string, userId: string): SessionContext => ({
    sessionId, userId,
    command: 'scraper', nodeId: 'N1',
    startedAt: Date.now(), uiHandle: null,
})

const stubHandle = (sessionId: string): InvocationHandle => ({
    sessionId,
    async send() {},
    async cancel() {},
    async *events() {},
})

describe('SessionIndex', () => {
    it('registers, looks up by session and user, and removes cleanly', () => {
        const idx = new SessionIndex()
        idx.register(ctx('s1', 'alice'), stubHandle('s1'))
        idx.register(ctx('s2', 'alice'), stubHandle('s2'))
        idx.register(ctx('s3', 'bob'),   stubHandle('s3'))

        expect(idx.getBySession('s1')!.ctx.userId).toBe('alice')
        expect(idx.getBySession('missing')).toBeNull()
        expect(idx.getByUser('alice').map((e) => e.ctx.sessionId).sort()).toEqual(['s1', 's2'])
        expect(idx.getByUser('bob').map((e) => e.ctx.sessionId)).toEqual(['s3'])
        expect(idx.list()).toHaveLength(3)

        idx.remove('s1')
        expect(idx.getByUser('alice').map((e) => e.ctx.sessionId)).toEqual(['s2'])
        idx.remove('s2')
        expect(idx.getByUser('alice')).toEqual([])
    })

    it('rejects double-register of the same sessionId', () => {
        const idx = new SessionIndex()
        idx.register(ctx('s1', 'alice'), stubHandle('s1'))
        expect(() => idx.register(ctx('s1', 'alice'), stubHandle('s1'))).toThrow(/already/)
    })

    it('remove of unknown sessionId is a no-op', () => {
        const idx = new SessionIndex()
        expect(() => idx.remove('nope')).not.toThrow()
    })
})
