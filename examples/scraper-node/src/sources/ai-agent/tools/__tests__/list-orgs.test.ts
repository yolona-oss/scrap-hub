import { makeListOrgsTool } from '../list-orgs'
import { WorkQueue } from '../../work-queue'

const seed = (name: string) => ({
    status: 'partial' as const,
    name,
    phones: [], emails: [], addresses: [], sources: [],
    gaps: ['phone', 'email', 'address'] as const,
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
})

describe('list_orgs tool', () => {
    it('returns all records with no filter', async () => {
        const wq = new WorkQueue()
        wq.insert({ ...seed('A'), gaps: [...seed('A').gaps] })
        wq.insert({ ...seed('B'), gaps: [...seed('B').gaps] })
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({})
        expect(r.orgs).toHaveLength(2)
        expect(r.orgs.map((o: any) => o.name).sort()).toEqual(['A', 'B'])
    })

    it('filters by status', async () => {
        const wq = new WorkQueue()
        const a = wq.insert({ ...seed('A'), gaps: [...seed('A').gaps] })
        wq.insert({ ...seed('B'), gaps: [...seed('B').gaps] })
        wq.transition(a.id, 'rejected')
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({ status: 'partial' })
        expect(r.orgs).toHaveLength(1)
        expect(r.orgs[0].name).toBe('B')
    })

    it('respects limit (default 20)', async () => {
        const wq = new WorkQueue()
        for (let i = 0; i < 25; i++) {
            wq.insert({ ...seed(`org${i}`), gaps: [...seed(`org${i}`).gaps] })
        }
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({})
        expect(r.orgs).toHaveLength(20)
    })

    it('ignores unknown status filter values gracefully', async () => {
        const wq = new WorkQueue()
        wq.insert({ ...seed('A'), gaps: [...seed('A').gaps] })
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({ status: 'bogus' })
        // Implementation choice: invalid status returns all records (treats as unfiltered).
        expect(r.orgs.length).toBeGreaterThan(0)
    })

    it('returns a summary projection per org (id, status, name, gaps, sourceCount)', async () => {
        const wq = new WorkQueue()
        wq.insert({ ...seed('A'), gaps: ['phone'] })
        const tool = makeListOrgsTool(wq)
        const r: any = await tool.handler({})
        expect(r.orgs[0]).toMatchObject({
            id: expect.any(String),
            status: 'partial',
            name: 'A',
            gaps: ['phone'],
            sourceCount: 0,
        })
    })
})
