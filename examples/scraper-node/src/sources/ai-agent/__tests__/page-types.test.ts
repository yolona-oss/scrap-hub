import type { PageType, ScoredLink, Block, ClassifiedPage } from '../page-types'

describe('page-types module', () => {
    it('exports PageType union with the five expected variants', () => {
        const _exhaustive: Record<PageType, true> = {
            'aggregator-landing': true,
            'aggregator-serp': true,
            'aggregator-detail': true,
            'org-site': true,
            'other': true,
        }
        expect(Object.keys(_exhaustive).length).toBe(5)
    })

    it('ScoredLink has url, score, reason, kind', () => {
        const link: ScoredLink = { url: 'https://x', score: 0.8, reason: 'r', kind: 'contact-page' }
        expect(link.kind).toBe('contact-page')
    })

    it('Block has selector, text, optional tels and mails', () => {
        const block: Block = { selector: 'footer', text: 'foo', tels: ['+7'], mails: ['a@b'] }
        expect(block.tels).toEqual(['+7'])
    })

    it('ClassifiedPage has all required fields', () => {
        const cp: ClassifiedPage = {
            url: 'https://x',
            pageType: 'org-site',
            confidence: 0.9,
            signals: [],
            cleanedText: '',
            candidateBlocks: [],
            jsonLdBlobs: [],
            contactCandidates: [],
            aggregatorCandidates: [],
            branchCandidates: [],
        }
        expect(cp.pageType).toBe('org-site')
    })
})
