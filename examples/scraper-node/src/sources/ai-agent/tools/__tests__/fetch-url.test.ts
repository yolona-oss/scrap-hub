import { buildFetchUrlHint } from '../fetch-url'

describe('buildFetchUrlHint', () => {
    it('returns skip hint for HTTP 4xx', () => {
        const hint = buildFetchUrlHint({ status: 404, content: '', truncated: false, error: 'HTTP 404' }, 'text')
        expect(hint).toMatch(/skip this URL/)
    })

    it('returns skip hint for HTTP 5xx', () => {
        const hint = buildFetchUrlHint({ status: 502, content: '', truncated: false, error: 'HTTP 502' }, 'text')
        expect(hint).toMatch(/skip this URL/)
    })

    it('text mode with no contact markers — try html mode hint', () => {
        const hint = buildFetchUrlHint({ status: 200, content: 'just plain text about lawyers', truncated: false }, 'text')
        expect(hint).toMatch(/mode='html'/)
    })

    it('text mode with phone markers — call report_results hint', () => {
        const hint = buildFetchUrlHint({ status: 200, content: 'тел: +7 (495) 123-45-67', truncated: false }, 'text')
        expect(hint).toMatch(/report_results/)
    })

    it('html mode with thin body — skip hint', () => {
        const hint = buildFetchUrlHint({ status: 200, content: '<html></html>', truncated: false }, 'html')
        expect(hint).toMatch(/skip/)
    })

    it('html mode with normal body — call extract_contacts hint', () => {
        const longBody = '<html><body>' + 'x'.repeat(800) + '</body></html>'
        const hint = buildFetchUrlHint({ status: 200, content: longBody, truncated: false }, 'html')
        expect(hint).toMatch(/extract_contacts/)
    })
})
