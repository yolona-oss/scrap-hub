import { makeFillGapTool } from '../fill-gap'
import type { FillGapContext } from '../fill-gap'
import { WorkQueue } from '../../work-queue'
import type { ClassifiedPage } from '../../page-types'
import type { OrgGap } from '../../work-queue'
import type { SearchQuery } from '../../../../types'

function fakePage(partial: Partial<ClassifiedPage> = {}): ClassifiedPage {
    return {
        url: 'https://x', pageType: 'org-site', confidence: 0.85, signals: [],
        cleanedText: '', candidateBlocks: [], jsonLdBlobs: [],
        contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        html: '<html></html>',
        ...partial,
    }
}

const seed = (overrides: any = {}) => ({
    status: 'partial' as const,
    name: 'Acme',
    phones: [], emails: [], addresses: [],
    sources: [],
    gaps: ['phone', 'email', 'address'] as OrgGap[],
    frontier: [],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
    ...overrides,
})

const QUERY: SearchQuery = { query: 'q', city: 'Санкт-Петербург', sources: ['ai-agent'], maxResults: 100 }

function makeCtx(overrides: Partial<FillGapContext> = {}): FillGapContext {
    return {
        webSearch: jest.fn().mockResolvedValue({ results: [] }),
        classifyPage: jest.fn().mockResolvedValue(fakePage()),
        extractContacts: jest.fn().mockResolvedValue({
            phones: [], emails: [], addresses: [], candidateName: '',
        }),
        ...overrides,
    }
}

describe('fill_gap tool', () => {
    it('fills the requested field via web_search + classify + extract', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ phones: ['+78121001010'], gaps: ['email', 'address'] as OrgGap[] }))
        const ctx = makeCtx({
            webSearch: jest.fn().mockResolvedValue({
                results: [{ url: 'https://acme.ru/', title: 'Acme', snippet: '' }],
            }),
            classifyPage: jest.fn().mockResolvedValue(fakePage({ html: '<body>info@acme.ru</body>' })),
            extractContacts: jest.fn().mockResolvedValue({
                phones: [], emails: ['info@acme.ru'], addresses: [], candidateName: '',
            }),
        })
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'email' })
        expect(out.error).toBeUndefined()
        expect(out.foundValue).toBe('info@acme.ru')
        const after = wq.get(r.id)!
        expect(after.emails).toEqual(['info@acme.ru'])
        expect(after.gaps).not.toContain('email')
    })

    it('issues a query of the form `"<name>" <field-keyword> <city>`', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ name: 'ООО "Ромашка"' }))
        const webSearch = jest.fn().mockResolvedValue({ results: [] })
        const ctx = makeCtx({ webSearch })
        const tool = makeFillGapTool(wq, ctx, QUERY)
        await tool.handler({ orgId: r.id, field: 'phone' })
        expect(webSearch).toHaveBeenCalledWith(
            expect.objectContaining({ query: expect.stringContaining('ООО "Ромашка"') }),
            expect.anything(),
        )
        const calledWith = webSearch.mock.calls[0][0].query as string
        expect(calledWith).toContain('телефон')
        expect(calledWith).toContain('Санкт-Петербург')
    })

    it('returns error for an unknown field', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = makeCtx()
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'bogus' })
        expect(out.error).toMatch(/field/i)
        expect(ctx.webSearch).not.toHaveBeenCalled()
    })

    it('returns error for unknown orgId', async () => {
        const wq = new WorkQueue()
        const ctx = makeCtx()
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: 'nope', field: 'phone' })
        expect(out.error).toMatch(/not found/i)
    })

    it('is a no-op when the requested field is not in gaps', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ phones: ['+78121001010'], gaps: ['email', 'address'] as OrgGap[] }))
        const ctx = makeCtx()
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'phone' })
        expect(out.alreadyFilled).toBe(true)
        expect(ctx.webSearch).not.toHaveBeenCalled()
    })

    it('per-(orgId, field) budget of 1: second call short-circuits', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const webSearch = jest.fn().mockResolvedValue({ results: [] })
        const ctx = makeCtx({ webSearch })
        const tool = makeFillGapTool(wq, ctx, QUERY)
        await tool.handler({ orgId: r.id, field: 'email' })
        const out: any = await tool.handler({ orgId: r.id, field: 'email' })
        expect(out.alreadyAttempted).toBe(true)
        expect(webSearch).toHaveBeenCalledTimes(1)
    })

    it('discards extracted values for fields other than the requested one', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const ctx = makeCtx({
            webSearch: jest.fn().mockResolvedValue({ results: [{ url: 'https://x', title: '', snippet: '' }] }),
            classifyPage: jest.fn().mockResolvedValue(fakePage()),
            extractContacts: jest.fn().mockResolvedValue({
                phones: ['+78122002020'],
                emails: ['info@acme.ru'],
                addresses: ['ул. Ленина, 5'],
                candidateName: '',
            }),
        })
        const tool = makeFillGapTool(wq, ctx, QUERY)
        await tool.handler({ orgId: r.id, field: 'email' })
        const after = wq.get(r.id)!
        expect(after.emails).toEqual(['info@acme.ru'])
        expect(after.phones).toEqual([])
        expect(after.addresses).toEqual([])
    })

    it('surfaces a conflict when extraction differs from an existing value (defensive branch)', async () => {
        // Realistic flow: harvest_serp seeded a phone; deepen finished without
        // changing it; the LLM hand-forces fill_gap on phone (perhaps the
        // existing value looked off). With existing values present + new
        // value differs, fill_gap records a conflict instead of silently
        // overwriting. Note: recomputeGaps would not normally produce
        // gaps:['phone'] here — we hand-set it to exercise the branch.
        const wq = new WorkQueue()
        const r = wq.insert(seed({ phones: ['+78121001010'] }))
        wq.mutate(r.id, draft => { draft.gaps = ['phone'] })
        const ctx = makeCtx({
            webSearch: jest.fn().mockResolvedValue({ results: [{ url: 'https://other.ru', title: '', snippet: '' }] }),
            classifyPage: jest.fn().mockResolvedValue(fakePage()),
            extractContacts: jest.fn().mockResolvedValue({
                phones: ['+78122002020'], emails: [], addresses: [], candidateName: '',
            }),
        })
        const tool = makeFillGapTool(wq, ctx, QUERY)
        await tool.handler({ orgId: r.id, field: 'phone' })
        const after = wq.get(r.id)!
        expect(after.phones).toContain('+78121001010')
        expect(after.phones).toContain('+78122002020')
        expect(after.conflicts?.length).toBe(1)
        const conflict = after.conflicts![0]
        expect(conflict.field).toBe('phone')
        expect(conflict.values.map(v => v.value).sort()).toEqual(['+78121001010', '+78122002020'])
        expect(conflict.values.find(v => v.value === '+78122002020')?.sourceUrl).toBe('https://other.ru')
    })

    it('handles web_search returning no results gracefully', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const ctx = makeCtx({
            webSearch: jest.fn().mockResolvedValue({ results: [] }),
        })
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'email' })
        expect(out.error).toBeUndefined()
        expect(out.foundValue).toBeUndefined()
        expect(ctx.classifyPage).not.toHaveBeenCalled()
    })

    it('handles classify failure without leaking the exception', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const ctx = makeCtx({
            webSearch: jest.fn().mockResolvedValue({ results: [{ url: 'https://x', title: '', snippet: '' }] }),
            classifyPage: jest.fn().mockRejectedValue(new Error('boom')),
        })
        const tool = makeFillGapTool(wq, ctx, QUERY)
        const out: any = await tool.handler({ orgId: r.id, field: 'email' })
        expect(out.error).toMatch(/classify/i)
    })

    it('records a web-search source ref on success', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ gaps: ['email'] as OrgGap[] }))
        const ctx = makeCtx({
            webSearch: jest.fn().mockResolvedValue({ results: [{ url: 'https://acme.ru', title: '', snippet: '' }] }),
            classifyPage: jest.fn().mockResolvedValue(fakePage()),
            extractContacts: jest.fn().mockResolvedValue({
                phones: [], emails: ['hi@acme.ru'], addresses: [], candidateName: '',
            }),
        })
        const tool = makeFillGapTool(wq, ctx, QUERY)
        await tool.handler({ orgId: r.id, field: 'email' })
        const after = wq.get(r.id)!
        expect(after.sources.some(s => s.kind === 'web-search' && s.url === 'https://acme.ru')).toBe(true)
    })
})
