import { buildReportResultsHint } from '../report-results'

describe('buildReportResultsHint', () => {
    const city = 'СПб'

    it('returns all-rejected hint when accepted=0', () => {
        const hint = buildReportResultsHint({ accepted: 0, rejected: 3, totalYielded: 0 }, 5, city)
        expect(hint).toMatch(/all candidates rejected/)
        expect(hint).toMatch(/СПб/)
    })

    it('returns target-reached hint when totalYielded >= target', () => {
        const hint = buildReportResultsHint({ accepted: 2, rejected: 0, totalYielded: 5 }, 5, city)
        expect(hint).toMatch(/target reached/)
    })

    it('returns remaining-count hint when partial', () => {
        const hint = buildReportResultsHint({ accepted: 2, rejected: 0, totalYielded: 3 }, 5, city)
        expect(hint).toMatch(/2 more orgs needed/)
    })
})
