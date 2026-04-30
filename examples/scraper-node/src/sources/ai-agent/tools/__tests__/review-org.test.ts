import { makeReviewOrgTool } from '../review-org'
import { WorkQueue } from '../../work-queue'
import { AsyncQueue } from '../../async-queue'
import type { OrgGap } from '../../work-queue'
import type { OrgData } from '../../../../types'

const seed = (overrides: any = {}) => ({
    status: 'partial' as const,
    name: 'Acme',
    phones: ['+78121001010'],
    emails: ['info@acme.ru'],
    addresses: ['ул. Ленина, 1'],
    sources: [],
    gaps: [] as OrgGap[],
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
    ...overrides,
})

function fakeJudge(content: string | null) {
    return { callJudge: jest.fn().mockResolvedValue({ content }) }
}

function newEmit(): AsyncQueue<OrgData> { return new AsyncQueue<OrgData>() }
async function drain(emit: AsyncQueue<OrgData>): Promise<OrgData[]> {
    emit.close()
    const out: OrgData[] = []
    for await (const x of emit) out.push(x)
    return out
}

describe('review_org tool', () => {
    it('verifies a saturated record and emits OrgData', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'saturated')
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'verify',
            confidence: 0.9,
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toBeUndefined()
        expect(out.decision).toBe('verify')
        const after = wq.get(r.id)!
        expect(after.status).toBe('verified')
        expect(after.confidence).toBe(0.9)
        const yielded = await drain(emit)
        expect(yielded).toHaveLength(1)
        expect(yielded[0].name).toBe('Acme')
        expect(yielded[0].status).toBe('verified')
    })

    it('routes partial → saturated → verified when verifying a still-partial record', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())  // status: partial
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'verify',
            confidence: 0.85,
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('verified')
    })

    it('rejects from saturated and emits nothing', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'saturated')
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'reject',
            confidence: 0.1,
            rejectReason: 'name does not match query topic',
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        await tool.handler({ orgId: r.id })
        const after = wq.get(r.id)!
        expect(after.status).toBe('rejected')
        expect(after.notes.some(n => n.includes('name does not match'))).toBe(true)
        const yielded = await drain(emit)
        expect(yielded).toHaveLength(0)
    })

    it('keeps still-partial status and emits nothing', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'still-partial',
            confidence: 0.4,
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('partial')
        const yielded = await drain(emit)
        expect(yielded).toHaveLength(0)
    })

    it('applies resolutions to existing conflicts on verify', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            phones: ['+78121001010', '+78122002020'],
            conflicts: [{
                field: 'phone' as const,
                values: [
                    { value: '+78121001010', sourceUrl: 'a' },
                    { value: '+78122002020', sourceUrl: 'b' },
                ],
                resolution: 'unresolved' as const,
            }],
        }))
        wq.transition(r.id, 'saturated')
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'verify',
            confidence: 0.85,
            resolutions: [{ field: 'phone', chosenIndex: 0 }],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        await tool.handler({ orgId: r.id })
        const after = wq.get(r.id)!
        expect(after.conflicts?.[0].chosenIndex).toBe(0)
        expect(after.conflicts?.[0].resolution).toBe('review')
    })

    it('returns error for unknown id', async () => {
        const wq = new WorkQueue()
        const emit = newEmit()
        const ctx = fakeJudge('{}')
        const tool = makeReviewOrgTool(wq, ctx, emit)
        const out: any = await tool.handler({ orgId: 'nope' })
        expect(out.error).toMatch(/not found/i)
        expect(ctx.callJudge).not.toHaveBeenCalled()
    })

    it('returns error if record is already terminal', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'saturated')
        wq.transition(r.id, 'rejected')
        const emit = newEmit()
        const ctx = fakeJudge('{}')
        const tool = makeReviewOrgTool(wq, ctx, emit)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/terminal|already/i)
        expect(ctx.callJudge).not.toHaveBeenCalled()
    })

    it('returns error on malformed JSON', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const emit = newEmit()
        const ctx = fakeJudge('not valid json {{')
        const tool = makeReviewOrgTool(wq, ctx, emit)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/parse|response/i)
    })

    it('returns error when confidence is missing or non-numeric', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({ decision: 'verify', resolutions: [] }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/confidence/i)
    })

    it('returns error when reject decision lacks rejectReason', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'reject',
            confidence: 0.1,
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/reject.*reason|rejectReason/i)
    })

    it('returns error when a resolution chosenIndex is out of range', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            conflicts: [{
                field: 'phone' as const,
                values: [{ value: 'a', sourceUrl: '' }, { value: 'b', sourceUrl: '' }],
                resolution: 'unresolved' as const,
            }],
        }))
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'verify',
            confidence: 0.9,
            resolutions: [{ field: 'phone', chosenIndex: 99 }],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/chosenIndex|out of range/i)
        // The record's status must not have changed.
        expect(wq.get(r.id)?.status).toBe('partial')
    })

    it('per-record terminal cap: second verify call short-circuits', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'saturated')
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'verify',
            confidence: 0.9,
            resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        await tool.handler({ orgId: r.id })
        // After verify, the record is terminal — the "already terminal" guard
        // covers this case. Confirm callJudge ran exactly once.
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/terminal|already/i)
        expect(ctx.callJudge).toHaveBeenCalledTimes(1)
    })

    it('still-partial does NOT consume the per-record cap (LLM can re-review after deepening)', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const emit = newEmit()
        const ctx = {
            callJudge: jest.fn()
                .mockResolvedValueOnce({ content: JSON.stringify({
                    decision: 'still-partial', confidence: 0.4, resolutions: [],
                }) })
                .mockResolvedValueOnce({ content: JSON.stringify({
                    decision: 'still-partial', confidence: 0.5, resolutions: [],
                }) }),
        }
        const tool = makeReviewOrgTool(wq, ctx, emit)
        await tool.handler({ orgId: r.id })
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toBeUndefined()
        expect(out.decision).toBe('still-partial')
        expect(ctx.callJudge).toHaveBeenCalledTimes(2)
    })

    it('records reviewedAt note on terminal decision', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'saturated')
        const emit = newEmit()
        const ctx = fakeJudge(JSON.stringify({
            decision: 'verify', confidence: 0.9, resolutions: [],
        }))
        const tool = makeReviewOrgTool(wq, ctx, emit)
        await tool.handler({ orgId: r.id })
        const after = wq.get(r.id)!
        expect(after.notes.some(n => n.startsWith('reviewed:'))).toBe(true)
    })
})
