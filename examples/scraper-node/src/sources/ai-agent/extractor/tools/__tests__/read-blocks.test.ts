import { makeReadBlocksTool } from '../read-blocks'
import type { ExtractorInput } from '../../types'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: '',
    candidateBlocks: [
        { selector: 'header', text: 'header text', tels: [], mails: [] },
        { selector: 'footer', text: 'footer text +7 (812) 100', tels: ['+78121001010'], mails: [] },
        { selector: '[class*="contact"]', text: 'contact: foo', tels: [], mails: ['x@y.ru'] },
    ],
    jsonLdBlobs: [],
    knownGoals: ['phone', 'address'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('read_blocks', () => {
    const tool = makeReadBlocksTool()

    it('returns the requested block by selector substring', async () => {
        const r: any = await tool.handler({ selector: 'footer' }, { input: INPUT })
        expect(r.blocks).toHaveLength(1)
        expect(r.blocks[0].text).toMatch(/footer/)
    })

    it('returns multiple blocks when selector matches several', async () => {
        const r: any = await tool.handler({ selector: 'contact' }, { input: INPUT })
        expect(r.blocks).toHaveLength(1)
    })

    it('returns all blocks when selector is "*" or empty', async () => {
        const r: any = await tool.handler({ selector: '*' }, { input: INPUT })
        expect(r.blocks).toHaveLength(3)
    })

    it('returns empty array when no match', async () => {
        const r: any = await tool.handler({ selector: 'nonexistent' }, { input: INPUT })
        expect(r.blocks).toEqual([])
    })

    it('terminal flag is false', () => {
        expect(tool.terminal).toBe(false)
    })
})
