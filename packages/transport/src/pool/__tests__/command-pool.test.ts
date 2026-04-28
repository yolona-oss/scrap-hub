import { CommandPool, PoolJoinResult } from '../command-pool'
import { branch } from '@cmd-hub/common'

const cmd = (n: string, cid: string, v: string) => ({
    name: n, compatibilityId: cid, version: v, description: '',
    options: branch({}), aliases: [],
})

describe('CommandPool', () => {
    it('accepts a compatible second registration', () => {
        const p = new CommandPool()
        expect(p.join('A', cmd('scraper', 'com.ex.s', '1.0.0'))).toEqual<PoolJoinResult>({ ok: true })
        expect(p.join('B', cmd('scraper', 'com.ex.s', '1.2.3'))).toEqual<PoolJoinResult>({ ok: true })
        expect(p.members('scraper').map((m) => m.nodeId).sort()).toEqual(['A', 'B'])
    })

    it('rejects same name with different compatibility_id', () => {
        const p = new CommandPool()
        p.join('A', cmd('scraper', 'com.ex.s', '1.0.0'))
        const r = p.join('B', cmd('scraper', 'com.other', '1.0.0'))
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toMatch(/compatibility_id/)
    })

    it('rejects same name + cid but incompatible major', () => {
        const p = new CommandPool()
        p.join('A', cmd('scraper', 'com.ex.s', '1.0.0'))
        const r = p.join('B', cmd('scraper', 'com.ex.s', '2.0.0'))
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toMatch(/major/)
    })

    it('rejects missing compatibility_id or version', () => {
        const p = new CommandPool()
        expect(p.join('A', cmd('x', '', '1.0.0')).ok).toBe(false)
        expect(p.join('A', cmd('x', 'com.ex', '')).ok).toBe(false)
    })

    it('rejects invalid semver', () => {
        const p = new CommandPool()
        const r = p.join('A', cmd('x', 'cid', 'banana'))
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.reason).toMatch(/semver/)
    })

    it('round-robins across healthy peers', () => {
        const p = new CommandPool()
        p.join('A', cmd('s', 'cid', '1.0.0'))
        p.join('B', cmd('s', 'cid', '1.0.0'))
        p.join('C', cmd('s', 'cid', '1.0.0'))
        const picks = [p.pick('s'), p.pick('s'), p.pick('s'), p.pick('s')]
        expect(picks.map((x) => x!.nodeId)).toEqual(['A', 'B', 'C', 'A'])
    })

    it('user override picks a specific node if it is a peer', () => {
        const p = new CommandPool()
        p.join('A', cmd('s', 'cid', '1.0.0'))
        p.join('B', cmd('s', 'cid', '1.0.0'))
        expect(p.pick('s', { nodeId: 'B' })!.nodeId).toBe('B')
        expect(p.pick('s', { nodeId: 'Z' })).toBeNull()
    })

    it('removeNode cleans a node out of every pool and deletes emptied pools', () => {
        const p = new CommandPool()
        p.join('A', cmd('s', 'cid', '1.0.0'))
        p.join('B', cmd('s', 'cid', '1.0.0'))
        p.removeNode('A')
        expect(p.members('s').map((m) => m.nodeId)).toEqual(['B'])
        p.removeNode('B')
        expect(p.names()).toEqual([])
    })

    it('pick returns null for an unknown command', () => {
        expect(new CommandPool().pick('nope')).toBeNull()
    })
})
