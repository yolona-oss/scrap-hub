import { makeRefetchTool } from '../refetch'
import type { ExtractorInput } from '../../types'
import type { ClassifiedPage } from '../../../page-types'

const INPUT: ExtractorInput = {
    url: 'https://acme.ru/',
    pageType: 'org-site',
    cleanedText: '',
    candidateBlocks: [],
    jsonLdBlobs: [],
    knownGoals: ['phone'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

function fakePage(partial: Partial<ClassifiedPage> = {}): ClassifiedPage {
    return {
        url: 'https://acme.ru/contacts',
        pageType: 'org-site',
        confidence: 0.85,
        signals: [],
        cleanedText: 'Contacts page',
        candidateBlocks: [],
        jsonLdBlobs: [],
        contactCandidates: [],
        aggregatorCandidates: [],
        branchCandidates: [],
        ...partial,
    }
}

describe('refetch tool', () => {
    it('terminal flag is false', () => {
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 3,
            classifyPage: async () => fakePage(),
        })
        expect(t.terminal).toBe(false)
    })

    it('rejects cross-origin refetch when originalUrl is set', async () => {
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 3,
            classifyPage: async () => fakePage(),
        })
        const r: any = await t.handler(
            { url: 'https://other.ru/contacts', reason: 'contact-page' },
            { input: INPUT },
        )
        expect(r.error).toMatch(/cross-origin|same-origin/i)
    })

    it('allows same-origin refetch and returns structured payload', async () => {
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 3,
            classifyPage: async () => fakePage({ cleanedText: 'page text' }),
        })
        const r: any = await t.handler(
            { url: 'https://acme.ru/contacts', reason: 'contact-page' },
            { input: INPUT },
        )
        expect(r.error).toBeUndefined()
        expect(r.url).toBe('https://acme.ru/contacts')
        expect(r.newPageType).toBe('org-site')
        expect(r.cleanedText).toBe('page text')
        expect(r.partialResult).toBeDefined()
    })

    it('exhausts per-URL budget after maxRefetches attempts', async () => {
        let callCount = 0
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 2,
            classifyPage: async () => { callCount++; return fakePage() },
        })
        await t.handler({ url: 'https://acme.ru/contacts', reason: 'contact-page' }, { input: INPUT })
        await t.handler({ url: 'https://acme.ru/contacts', reason: 'contact-page' }, { input: INPUT })
        const r: any = await t.handler({ url: 'https://acme.ru/contacts', reason: 'contact-page' }, { input: INPUT })
        expect(r.error).toMatch(/budget|exhaust/i)
        expect(callCount).toBe(2) // Third call short-circuits before classifyPage.
    })

    it('different URLs each get their own per-URL budget', async () => {
        let callCount = 0
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 1,
            classifyPage: async () => { callCount++; return fakePage() },
        })
        const r1: any = await t.handler({ url: 'https://acme.ru/a', reason: 'contact-page' }, { input: INPUT })
        const r2: any = await t.handler({ url: 'https://acme.ru/b', reason: 'branch-detail' }, { input: INPUT })
        expect(r1.error).toBeUndefined()
        expect(r2.error).toBeUndefined()
        expect(callCount).toBe(2)
    })

    it('first refetch sets the origin when originalUrl is empty (fallback)', async () => {
        const t = makeRefetchTool({
            originalUrl: '',
            maxRefetches: 3,
            classifyPage: async () => fakePage(),
        })
        const r1: any = await t.handler({ url: 'https://acme.ru/', reason: 'other' }, { input: INPUT })
        expect(r1.error).toBeUndefined()
        // Now subsequent cross-origin must be rejected.
        const r2: any = await t.handler({ url: 'https://other.ru/', reason: 'other' }, { input: INPUT })
        expect(r2.error).toMatch(/cross-origin|same-origin/i)
    })

    it('rejects malformed URLs', async () => {
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 3,
            classifyPage: async () => fakePage(),
        })
        const r: any = await t.handler({ url: 'not-a-url', reason: 'other' }, { input: INPUT })
        expect(r.error).toBeDefined()
    })

    it('returns classifyPage error as a tool error (not throw)', async () => {
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 3,
            classifyPage: async () => { throw new Error('network down') },
        })
        const r: any = await t.handler({ url: 'https://acme.ru/x', reason: 'other' }, { input: INPUT })
        expect(r.error).toMatch(/network down|fetch/i)
    })

    it('reason field is recorded but does not affect outcome', async () => {
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 3,
            classifyPage: async () => fakePage(),
        })
        const r1: any = await t.handler({ url: 'https://acme.ru/x', reason: 'iframe-content' }, { input: INPUT })
        expect(r1.error).toBeUndefined()
        // No assertion on reason in payload — it's logging-only.
    })

    it('runs microdata + semantic-html strategies when ClassifiedPage.html is present', async () => {
        const html = `<html><body>
            <a href="tel:+78121001010">phone</a>
            <a href="mailto:info@acme.ru">mail</a>
            <div itemprop="address">ул. Ленина, 1</div>
        </body></html>`
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 3,
            classifyPage: async () => fakePage({ html, cleanedText: '' }),
        })
        const r: any = await t.handler({ url: 'https://acme.ru/contacts', reason: 'contact-page' }, { input: INPUT })
        expect(r.error).toBeUndefined()
        expect(r.partialResult.phones).toContain('+78121001010')
        expect(r.partialResult.emails).toContain('info@acme.ru')
        expect(r.partialResult.addresses[0]).toMatch(/Ленина/)
    })

    it('falls back to JSON-LD + regex when html is absent', async () => {
        const t = makeRefetchTool({
            originalUrl: 'https://acme.ru/',
            maxRefetches: 3,
            classifyPage: async () => fakePage({
                cleanedText: 'Phone: +7 (812) 100-10-10',
            }),
        })
        const r: any = await t.handler({ url: 'https://acme.ru/x', reason: 'other' }, { input: INPUT })
        expect(r.error).toBeUndefined()
        expect(r.partialResult.phones.length).toBeGreaterThan(0)
    })
})
