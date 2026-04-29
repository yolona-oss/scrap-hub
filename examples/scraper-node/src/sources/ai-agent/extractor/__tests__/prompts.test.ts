import { buildExtractorSystemPrompt, buildExtractorUserPrompt } from '../prompts'
import type { ExtractorInput } from '../types'

const INPUT: ExtractorInput = {
    url: 'https://acme-clinic.ru/',
    pageType: 'org-site',
    cleanedText: 'About us. Call +7 (812) ...',
    candidateBlocks: [
        { selector: 'header', text: 'header text', tels: [], mails: [] },
        { selector: 'footer', text: 'footer text', tels: ['+78121001010'], mails: [] },
    ],
    jsonLdBlobs: [{ '@type': 'WebPage' }],
    knownGoals: ['phone', 'address'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('buildExtractorSystemPrompt', () => {
    it('mentions the role and the four tools', () => {
        const p = buildExtractorSystemPrompt()
        expect(p).toMatch(/extract/i)
        expect(p).toMatch(/read_blocks/)
        expect(p).toMatch(/read_json_blob/)
        expect(p).toMatch(/report_extraction/)
        expect(p).toMatch(/report_incomplete/)
    })

    it('forbids inventing values', () => {
        const p = buildExtractorSystemPrompt()
        expect(p.toLowerCase()).toMatch(/do not invent|don't invent|never invent/)
    })

    it('explains the terminal-tool requirement', () => {
        const p = buildExtractorSystemPrompt()
        expect(p.toLowerCase()).toMatch(/(must|always).*(report_extraction|report_incomplete|terminal)/)
    })
})

describe('buildExtractorUserPrompt', () => {
    it('includes URL, pageType, knownGoals, cleanedText preview', () => {
        const p = buildExtractorUserPrompt(INPUT)
        expect(p).toMatch(/acme-clinic\.ru/)
        expect(p).toMatch(/org-site/)
        expect(p).toMatch(/phone/)
        expect(p).toMatch(/address/)
        expect(p).toMatch(/About us/)
    })

    it('lists candidateBlocks selectors', () => {
        const p = buildExtractorUserPrompt(INPUT)
        expect(p).toMatch(/header/)
        expect(p).toMatch(/footer/)
    })

    it('truncates cleanedText to 8000 chars', () => {
        const big: ExtractorInput = { ...INPUT, cleanedText: 'A'.repeat(20000) }
        const p = buildExtractorUserPrompt(big)
        expect(p.length).toBeLessThan(20000) // far less than the 20K cleanedText
    })
})
