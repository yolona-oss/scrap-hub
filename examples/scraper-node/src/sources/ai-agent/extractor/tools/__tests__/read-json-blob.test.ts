import { makeReadJsonBlobTool } from '../read-json-blob'
import type { ExtractorInput } from '../../types'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: '',
    candidateBlocks: [],
    jsonLdBlobs: [
        { '@type': 'WebPage', name: 'X' },
        { '@type': 'LocalBusiness', telephone: '+7' },
    ],
    nextDataBlob: { props: { pageProps: { contacts: { phone: '+78121001010' } } } },
    knownGoals: ['phone'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

describe('read_json_blob', () => {
    const tool = makeReadJsonBlobTool()

    it('returns the parsed __NEXT_DATA__ blob when name="next-data"', async () => {
        const r: any = await tool.handler({ name: 'next-data' }, { input: INPUT })
        expect(r.blob).toBeDefined()
        expect((r.blob as any).props.pageProps.contacts.phone).toBe('+78121001010')
    })

    it('returns all jsonLdBlobs when name="json-ld"', async () => {
        const r: any = await tool.handler({ name: 'json-ld' }, { input: INPUT })
        expect(Array.isArray(r.blobs)).toBe(true)
        expect(r.blobs).toHaveLength(2)
    })

    it('returns null when name="next-data" but blob absent', async () => {
        const inputNoNext: ExtractorInput = { ...INPUT, nextDataBlob: undefined }
        const r: any = await tool.handler({ name: 'next-data' }, { input: inputNoNext })
        expect(r.blob).toBeNull()
    })

    it('returns error for unknown blob name', async () => {
        const r: any = await tool.handler({ name: 'unknown' }, { input: INPUT })
        expect(r.error).toBeDefined()
    })

    it('terminal flag is false', () => {
        expect(tool.terminal).toBe(false)
    })
})
