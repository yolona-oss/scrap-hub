import { makeReportIncompleteTool } from '../report-incomplete'
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

describe('report_incomplete', () => {
    const tool = makeReportIncompleteTool()

    it('terminal flag is true', () => {
        expect(tool.terminal).toBe(true)
    })

    it('returns incomplete with reason and hints', async () => {
        const r: any = await tool.handler({
            reason: 'no contacts on this page',
            hints: ['try /contacts'],
        }, { input: INPUT })
        expect(r.outcome).toBe('incomplete')
        expect(r.reason).toBe('no contacts on this page')
        expect(r.hints).toEqual(['try /contacts'])
    })

    it('coerces missing reason to a default', async () => {
        const r: any = await tool.handler({}, { input: INPUT })
        expect(r.outcome).toBe('incomplete')
        expect(r.reason).toBeTruthy()
    })

    it('drops non-string hints', async () => {
        const r: any = await tool.handler({
            reason: 'r', hints: ['a', 42, null, 'b'],
        }, { input: INPUT })
        expect(r.hints).toEqual(['a', 'b'])
    })
})
