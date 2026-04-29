import { buildParseHtmlHint } from '../parse-html'

describe('buildParseHtmlHint', () => {
    it('returns broader-selector hint when 0 matches', () => {
        const hint = buildParseHtmlHint({ matches: [], count: 0, truncated: false })
        expect(hint).toMatch(/broader selector/)
    })

    it('returns narrow-selector hint when truncated', () => {
        const hint = buildParseHtmlHint({ matches: ['a', 'b'], count: 2, truncated: true })
        expect(hint).toMatch(/narrow your selector/)
    })

    it('returns no hint for normal results', () => {
        const hint = buildParseHtmlHint({ matches: ['x'], count: 1, truncated: false })
        expect(hint).toBeUndefined()
    })
})
