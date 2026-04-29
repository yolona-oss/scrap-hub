import { makeDeepenOrgTool } from '../deepen-org'
import { WorkQueue } from '../../work-queue'
import type { ClassifiedPage } from '../../page-types'
import type { OrgGap } from '../../work-queue'

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
    frontier: [{ url: 'https://acme.ru/contacts', reason: 'contact-page', score: 0.9 }],
    confidence: 0.5,
    extractionMethod: 'deterministic' as const,
    notes: [],
    ...overrides,
})

const MAX_BUDGET = 5

describe('deepen_org tool', () => {
    it('classifies + extracts a frontier URL and merges into the record', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({
                phones: ['+78121001010'], emails: [], addresses: [], candidateName: '',
            }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, MAX_BUDGET)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toBeUndefined()
        const after = wq.get(r.id)!
        expect(after.phones).toContain('+78121001010')
        expect(after.gaps).not.toContain('phone')
        expect(after.perOrgToolCallsUsed).toBeGreaterThan(0)
    })

    it('transitions to saturated when all gaps fill', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({
                phones: ['+78121001010'], emails: ['info@acme.ru'], addresses: ['ул. Ленина, 1'],
                candidateName: '',
            }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, MAX_BUDGET)
        await tool.handler({ orgId: r.id })
        expect(wq.get(r.id)?.status).toBe('saturated')
    })

    it('stops when budget exhausted', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            frontier: [
                { url: 'https://acme.ru/a', reason: 'x', score: 0.9 },
                { url: 'https://acme.ru/b', reason: 'x', score: 0.8 },
                { url: 'https://acme.ru/c', reason: 'x', score: 0.7 },
                { url: 'https://acme.ru/d', reason: 'x', score: 0.6 },
            ],
        }))
        let calls = 0
        const ctx = {
            classifyPage: async () => { calls++; return fakePage() },
            extractContacts: async () => { calls++; return { phones: [], emails: [], addresses: [], candidateName: '' } },
        }
        const tool = makeDeepenOrgTool(wq, ctx, 4)  // budget = 4 → 2 hops max
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.budgetExhausted).toBe(true)
        const after = wq.get(r.id)!
        expect(after.perOrgToolCallsUsed).toBe(4)
    })

    it('processes frontier in score order (highest first)', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            frontier: [
                { url: 'https://acme.ru/low', reason: 'x', score: 0.3 },
                { url: 'https://acme.ru/high', reason: 'x', score: 0.9 },
            ],
        }))
        const visited: string[] = []
        const ctx = {
            classifyPage: async (url: string) => { visited.push(url); return fakePage({ url }) },
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 4)
        await tool.handler({ orgId: r.id })
        expect(visited[0]).toContain('/high')
    })

    it('skips other-pageType pages without burning extract budget', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({
            frontier: [{ url: 'https://acme.ru/blog', reason: 'x', score: 0.5 }],
        }))
        let extractCalls = 0
        const ctx = {
            classifyPage: async () => fakePage({ pageType: 'other' }),
            extractContacts: async () => { extractCalls++; return { phones: [], emails: [], addresses: [], candidateName: '' } },
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        await tool.handler({ orgId: r.id })
        expect(extractCalls).toBe(0)
    })

    it('returns error for unknown id', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        const out: any = await tool.handler({ orgId: 'nope' })
        expect(out.error).toMatch(/not found/i)
    })

    it('returns no-op result when frontier is empty and record already has gaps', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed({ frontier: [] }))
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.frontierEmpty).toBe(true)
        expect(out.budgetExhausted).toBe(false)
    })

    it('appends contactCandidates to frontier when classifying an org-site', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        const ctx = {
            classifyPage: async () => fakePage({
                pageType: 'org-site',
                contactCandidates: [
                    { url: 'https://acme.ru/about', score: 0.7, reason: 'path', kind: 'contact-page' },
                    { url: 'https://acme.ru/locations', score: 0.6, reason: 'path', kind: 'contact-page' },
                ],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        await tool.handler({ orgId: r.id })
        const after = wq.get(r.id)!
        const urls = after.frontier.map(f => f.url)
        expect(urls).toContain('https://acme.ru/about')
    })

    it('refuses to deepen non-partial records', async () => {
        const wq = new WorkQueue()
        const r = wq.insert(seed())
        wq.transition(r.id, 'rejected')
        const ctx = {
            classifyPage: async () => fakePage(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDeepenOrgTool(wq, ctx, 5)
        const out: any = await tool.handler({ orgId: r.id })
        expect(out.error).toMatch(/not partial|already terminal/i)
    })
})
