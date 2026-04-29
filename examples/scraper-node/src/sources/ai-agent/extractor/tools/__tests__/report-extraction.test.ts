import { makeReportExtractionTool } from '../report-extraction'
import type { ExtractorInput } from '../../types'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: '',
    candidateBlocks: [],
    jsonLdBlobs: [],
    knownGoals: ['phone'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('report_extraction', () => {
    const tool = makeReportExtractionTool()

    it('terminal flag is true', () => {
        expect(tool.terminal).toBe(true)
    })

    it('accepts valid extraction with arrays + name + confidence', async () => {
        const r: any = await tool.handler({
            phones: ['+78121001010'],
            emails: ['a@b.ru'],
            addresses: ['ул. Ленина, 1'],
            candidateName: 'X',
            confidence: 0.85,
            notes: ['phone reassembled'],
        }, { input: INPUT })
        expect(r.outcome).toBe('extraction')
        expect(r.phones).toEqual(['+78121001010'])
        expect(r.confidence).toBe(0.85)
    })

    it('coerces missing arrays to empty', async () => {
        const r: any = await tool.handler({ candidateName: 'X', confidence: 0.5 }, { input: INPUT })
        expect(r.phones).toEqual([])
        expect(r.emails).toEqual([])
        expect(r.addresses).toEqual([])
    })

    it('clamps confidence to [0, 1]', async () => {
        const r1: any = await tool.handler({ candidateName: 'X', confidence: 1.5 }, { input: INPUT })
        expect(r1.confidence).toBe(1)
        const r2: any = await tool.handler({ candidateName: 'X', confidence: -0.3 }, { input: INPUT })
        expect(r2.confidence).toBe(0)
    })

    it('drops non-string entries from phones/emails/addresses', async () => {
        const r: any = await tool.handler({
            phones: ['+7', 42, null, '+78121001010'],
            candidateName: 'X',
            confidence: 0.5,
        }, { input: INPUT })
        expect(r.phones).toEqual(['+7', '+78121001010'])
    })

    it('passes notes through when provided', async () => {
        const r: any = await tool.handler({
            candidateName: 'X', confidence: 0.5, notes: ['a', 'b'],
        }, { input: INPUT })
        expect(r.notes).toEqual(['a', 'b'])
    })
})
