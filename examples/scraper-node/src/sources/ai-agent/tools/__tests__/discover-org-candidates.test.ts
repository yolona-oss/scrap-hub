import { makeDiscoverOrgCandidatesTool } from '../discover-org-candidates'
import type { ClassifiedPage } from '../../page-types'

function fakeClassify(partial: Partial<ClassifiedPage> = {}): ClassifiedPage {
    return {
        url: 'https://x', pageType: 'org-site', confidence: 0.8, signals: ['tel-link'],
        cleanedText: 'About us...', candidateBlocks: [],
        jsonLdBlobs: [],
        contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        ...partial,
    }
}

describe('discover_org_candidates tool', () => {
    it('classifies a URL and returns the summary', async () => {
        const ctx = {
            classifyPage: async () => fakeClassify({ pageType: 'aggregator-serp', signals: ['cards:8', 'pagination'] }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDiscoverOrgCandidatesTool(ctx)
        const r: any = await tool.handler({ url: 'https://zoon.ru/spb/medical/' })
        expect(r.url).toBe('https://x')
        expect(r.pageType).toBe('aggregator-serp')
        expect(r.signals).toContain('cards:8')
    })

    it('rejects empty url', async () => {
        const ctx = {
            classifyPage: async () => fakeClassify(),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDiscoverOrgCandidatesTool(ctx)
        const r: any = await tool.handler({ url: '' })
        expect(r.error).toBeDefined()
    })

    it('handles classifyPage throwing as a tool error (not throw)', async () => {
        const ctx = {
            classifyPage: async () => { throw new Error('network down') },
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDiscoverOrgCandidatesTool(ctx)
        const r: any = await tool.handler({ url: 'https://x' })
        expect(r.error).toMatch(/network down|fetch/i)
    })

    it('returns aggregator-related counts in the summary', async () => {
        const ctx = {
            classifyPage: async () => fakeClassify({
                pageType: 'aggregator-serp',
                jsonLdBlobs: [{}, {}, {}],
                candidateBlocks: [
                    { selector: 'header', text: 'h', tels: [], mails: [] },
                    { selector: 'footer', text: 'f', tels: ['+7'], mails: [] },
                ],
            }),
            extractContacts: async () => ({ phones: [], emails: [], addresses: [], candidateName: '' }),
        }
        const tool = makeDiscoverOrgCandidatesTool(ctx)
        const r: any = await tool.handler({ url: 'https://x' })
        expect(r.jsonLdCount).toBe(3)
        expect(r.candidateBlockCount).toBe(2)
    })
})
