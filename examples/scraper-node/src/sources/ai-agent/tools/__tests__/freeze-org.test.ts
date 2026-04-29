import { makeFreezeOrgTool } from '../freeze-org'
import { WorkQueue } from '../../work-queue'
import type { OrgGap } from '../../work-queue'

const seed = (name: string, contacts: { phones?: string[], gaps?: OrgGap[] } = {}) => ({
    status: 'partial' as const,
    name,
    phones: contacts.phones ?? [],
    emails: [],
    addresses: [],
    sources: [],
    gaps: contacts.gaps ?? ['phone', 'email', 'address'] as OrgGap[],
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
})

describe('freeze_org tool', () => {
    it('freezes partial with contacts as verified', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed('A', { phones: ['+78121001010'], gaps: ['email', 'address'] }))
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toBeUndefined()
        expect(wq.get(r.id)?.status).toBe('verified')
        expect(out.finalStatus).toBe('verified')
    })

    it('freezes contactless partial as rejected', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed('A'))
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('rejected')
        expect(out.finalStatus).toBe('rejected')
    })

    it('freezes saturated → verified', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed('A', { phones: ['+78121001010'], gaps: [] }))
        wq.transition(r.id, 'saturated')
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('verified')
        expect(out.finalStatus).toBe('verified')
    })

    it('returns error for unknown id', async () => {
        const wq = new WorkQueue()
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: 'nope' })
        expect(out.error).toMatch(/not found/i)
    })

    it('returns error if record is already terminal', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed('A', { phones: ['+7'] }))
        wq.transition(r.id, 'rejected')
        const tool = makeFreezeOrgTool(wq)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/terminal|already/i)
    })
})
