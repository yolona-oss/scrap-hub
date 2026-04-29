import type {
    ExtractorInput,
    ExtractionResult,
    ExtractorTool,
    ExtractorReport,
} from '../types'

describe('extractor types', () => {
    it('ExtractorInput has the expected required and optional fields', () => {
        const input: ExtractorInput = {
            url: 'https://example.com/',
            pageType: 'org-site',
            cleanedText: 'about us...',
            candidateBlocks: [],
            jsonLdBlobs: [],
            knownGoals: ['phone', 'address'],
            partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
        }
        expect(input.knownGoals).toEqual(['phone', 'address'])
    })

    it('ExtractionResult shape', () => {
        const r: ExtractionResult = {
            outcome: 'extraction',
            phones: ['+78121001010'],
            emails: [],
            addresses: [],
            candidateName: 'Acme',
            confidence: 0.85,
            notes: ['phone via extractor'],
            toolCallsUsed: 3,
        }
        expect(r.outcome).toBe('extraction')
        expect(r.confidence).toBe(0.85)
    })

    it('ExtractionResult can be incomplete', () => {
        const r: ExtractionResult = {
            outcome: 'incomplete',
            reason: 'no contact markers found',
            hints: ['try /contacts page'],
            toolCallsUsed: 5,
        }
        expect(r.outcome).toBe('incomplete')
    })

    it('ExtractorTool has name, description, parameters, handler, and a terminal flag', () => {
        const t: ExtractorTool = {
            name: 'noop',
            description: 'no op',
            parameters: { type: 'object', properties: {} },
            terminal: false,
            handler: async () => ({ ok: true }),
        }
        expect(t.terminal).toBe(false)
    })

    it('ExtractorReport allows extraction or incomplete', () => {
        const r1: ExtractorReport = { outcome: 'extraction', phones: ['+7'], emails: [], addresses: [], candidateName: '', confidence: 0.5 }
        const r2: ExtractorReport = { outcome: 'incomplete', reason: 'no hits' }
        expect(r1.outcome).toBe('extraction')
        expect(r2.outcome).toBe('incomplete')
    })

    it('RefetchedPagePayload has fields for the extractor LLM', () => {
        const payload: import('../types').RefetchedPagePayload = {
            url: 'https://x/contacts',
            newPageType: 'org-site',
            cleanedText: 'Contacts...',
            candidateBlocks: [],
            jsonLdBlobs: [],
            partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
        }
        expect(payload.newPageType).toBe('org-site')
    })
})
