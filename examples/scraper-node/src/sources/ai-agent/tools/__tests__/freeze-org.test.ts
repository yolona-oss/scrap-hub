import { makeFreezeOrgTool } from '../freeze-org'
import { WorkQueue } from '../../work-queue'
import { AsyncQueue } from '../../async-queue'
import type { OrgGap } from '../../work-queue'
import type { OrgData } from '../../../../types'

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

function setup() {
    const wq = new WorkQueue()
    const emit = new AsyncQueue<OrgData>()
    const tool = makeFreezeOrgTool(wq, emit)
    return { wq, emit, tool }
}

async function drain(emit: AsyncQueue<OrgData>): Promise<OrgData[]> {
    emit.close()
    const out: OrgData[] = []
    for await (const x of emit) out.push(x)
    return out
}

describe('freeze_org tool', () => {
    it('freezes partial with contacts as verified and emits OrgData', async () => {
        const { wq, emit, tool } = setup()
        const r = wq.insert(seed('A', { phones: ['+78121001010'], gaps: ['email', 'address'] }))
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toBeUndefined()
        expect(wq.get(r.id)?.status).toBe('verified')
        expect(out.finalStatus).toBe('verified')
        const yielded = await drain(emit)
        expect(yielded).toHaveLength(1)
        expect(yielded[0].name).toBe('A')
        expect(yielded[0].phones).toEqual(['+78121001010'])
        expect(yielded[0].status).toBe('verified')
    })

    it('freezes contactless partial as rejected and does NOT emit', async () => {
        const { wq, emit, tool } = setup()
        const r = wq.insert(seed('A'))
        const out: any = await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('rejected')
        expect(out.finalStatus).toBe('rejected')
        const yielded = await drain(emit)
        expect(yielded).toHaveLength(0)
    })

    it('freezes saturated → verified and emits', async () => {
        const { wq, emit, tool } = setup()
        const r = wq.insert(seed('A', { phones: ['+78121001010'], gaps: [] }))
        wq.transition(r.id, 'saturated')
        const out: any = await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('verified')
        expect(out.finalStatus).toBe('verified')
        const yielded = await drain(emit)
        expect(yielded).toHaveLength(1)
    })

    it('returns error for unknown id', async () => {
        const { tool } = setup()
        const out: any = await tool.handler({ orgId: 'nope' })
        expect(out.error).toMatch(/not found/i)
    })

    it('returns error if record is already terminal', async () => {
        const { wq, tool } = setup()
        const r = wq.insert(seed('A', { phones: ['+7'] }))
        wq.transition(r.id, 'rejected')
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/terminal|already/i)
    })
})
