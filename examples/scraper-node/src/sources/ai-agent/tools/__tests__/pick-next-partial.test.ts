import { makePickNextPartialTool } from '../pick-next-partial'
import { WorkQueue } from '../../work-queue'
import type { OrgGap } from '../../work-queue'

const seed = (name: string, gaps: OrgGap[] = ['phone', 'email', 'address']) => ({
    status: 'partial' as const,
    name,
    phones: [], emails: [], addresses: [], sources: [],
    gaps,
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
})

describe('pick_next_partial tool', () => {
    it('returns highest-priority partial', async () => {
        const wq = new WorkQueue()
        wq.insert(seed('A', ['phone', 'email', 'address']))
        const b = wq.insert(seed('B', ['phone']))
        wq.insert(seed('C', ['phone', 'email']))
        const tool = makePickNextPartialTool(wq)
        const r: any = await tool.handler({})
        expect(r.org?.id).toBe(b.id)
        expect(r.org?.name).toBe('B')
    })

    it('returns null when no partials remain', async () => {
        const wq = new WorkQueue()
        const a = wq.insert(seed('A'))
        wq.transition(a.id, 'rejected')
        const tool = makePickNextPartialTool(wq)
        const r: any = await tool.handler({})
        expect(r.org).toBeNull()
    })

    it('returns full record fields (not just summary)', async () => {
        const wq = new WorkQueue()
        wq.insert(seed('A', ['phone']))
        const tool = makePickNextPartialTool(wq)
        const r: any = await tool.handler({})
        expect(r.org).toMatchObject({
            id: expect.any(String),
            name: 'A',
            status: 'partial',
            gaps: ['phone'],
            phones: [],
            sources: [],
            frontier: [],
        })
    })
})
