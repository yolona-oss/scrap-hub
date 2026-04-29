import { buildSearchSourceHint } from '../delegate-source'

describe('buildSearchSourceHint', () => {
    it('returns nothing-found hint when accepted=0 and rejected=0', () => {
        const hint = buildSearchSourceHint({ accepted: 0, rejected: 0, totalYielded: 0 })
        expect(hint).toMatch(/returned nothing/)
    })

    it('returns all-rejected hint when accepted=0 rejected>0', () => {
        const hint = buildSearchSourceHint({ accepted: 0, rejected: 5, totalYielded: 0 })
        expect(hint).toMatch(/all failed validation/)
    })

    it('returns good-signal hint when accepted>0 rejected=0', () => {
        const hint = buildSearchSourceHint({ accepted: 5, rejected: 0, totalYielded: 5 })
        expect(hint).toMatch(/good signal/)
    })

    it('returns mixed-quality hint when both >0', () => {
        const hint = buildSearchSourceHint({ accepted: 3, rejected: 2, totalYielded: 3 })
        expect(hint).toMatch(/mixed quality/)
        expect(hint).toMatch(/40%/)
    })
})
