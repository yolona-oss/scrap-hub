import { makeHarvestSerpTool } from '../harvest-serp'
import { WorkQueue } from '../../work-queue'
import type { ClassifiedPage } from '../../page-types'
import type { SearchQuery } from '../../../../types'

const baseQuery: SearchQuery = { query: 'q', sources: [], maxResults: 5 }

function fakeClassify(partial: Partial<ClassifiedPage> = {}): ClassifiedPage {
    return {
        url: 'https://zoon.ru/spb/medical/', pageType: 'aggregator-serp',
        confidence: 0.85, signals: [], cleanedText: '', candidateBlocks: [],
        jsonLdBlobs: [],
        contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        ...partial,
    }
}

describe('harvest_serp tool', () => {
    it('creates one partial record per LocalBusiness JSON-LD entry', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                jsonLdBlobs: [
                    { '@type': 'LocalBusiness', name: 'Clinic A', telephone: '+78121001010' },
                    { '@type': 'LocalBusiness', name: 'Clinic B', telephone: '+78122002020' },
                    { '@type': 'WebPage', name: 'Page' },
                ],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx, baseQuery)
        const r: any = await tool.handler({ url: 'https://zoon.ru/spb/medical/' })
        expect(r.created).toBe(2)
        expect(wq.size()).toBe(2)
        const orgs = wq.list()
        expect(orgs.map(o => o.name).sort()).toEqual(['Clinic A', 'Clinic B'])
        expect(orgs[0].phones).toContain('+78121001010')
    })

    it('refuses to harvest non-aggregator-serp pages', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({ pageType: 'org-site' }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx, baseQuery)
        const r: any = await tool.handler({ url: 'https://x' })
        expect(r.error).toMatch(/not.*aggregator-serp|wrong page type/i)
        expect(wq.size()).toBe(0)
    })

    it('records the source ref with kind="aggregator-serp" on each created record', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                url: 'https://zoon.ru/spb/medical/',
                jsonLdBlobs: [{ '@type': 'LocalBusiness', name: 'A', telephone: '+7' }],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx, baseQuery)
        await tool.handler({ url: 'https://zoon.ru/spb/medical/' })
        const orgs = wq.list()
        expect(orgs[0].sources).toHaveLength(1)
        expect(orgs[0].sources[0].kind).toBe('aggregator-serp')
        expect(orgs[0].sources[0].url).toBe('https://zoon.ru/spb/medical/')
    })

    it('records gaps based on what was extracted', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                jsonLdBlobs: [{
                    '@type': 'LocalBusiness',
                    name: 'A',
                    telephone: '+78121001010',
                }],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx, baseQuery)
        await tool.handler({ url: 'https://x' })
        const orgs = wq.list()
        expect(orgs[0].gaps.sort()).toEqual(['address', 'email'])
    })

    it('returns 0 created when no LocalBusiness entries found', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                jsonLdBlobs: [{ '@type': 'WebPage' }],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx, baseQuery)
        const r: any = await tool.handler({ url: 'https://x' })
        expect(r.created).toBe(0)
        expect(wq.size()).toBe(0)
    })

    it('drops off-target-city addresses from JSON-LD entries', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify({
                jsonLdBlobs: [{
                    '@type': 'LocalBusiness',
                    name: 'Off-city Clinic',
                    telephone: '+78121001010',
                    // Plain string address with explicit "г. Москва" prefix —
                    // validateAndNormalizeAddress matches the г.<City> regex
                    // and rejects when it doesn't match the query city.
                    address: 'г. Москва, ул. Тверская, 7',
                }],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const queryWithCity: SearchQuery = { ...baseQuery, city: 'Санкт-Петербург' }
        const tool = makeHarvestSerpTool(wq, ctx, queryWithCity)
        await tool.handler({ url: 'https://zoon.ru/spb/medical/' })
        const orgs = wq.list()
        expect(orgs).toHaveLength(1)
        expect(orgs[0].addresses).toEqual([])
        // gaps should still include 'address' since it was dropped
        expect(orgs[0].gaps).toContain('address')
    })

    it('rejects empty url', async () => {
        const wq = new WorkQueue()
        const ctx = {
            classifyPage: async () => fakeClassify(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeHarvestSerpTool(wq, ctx, baseQuery)
        const r: any = await tool.handler({ url: '' })
        expect(r.error).toMatch(/empty url/i)
    })
})
