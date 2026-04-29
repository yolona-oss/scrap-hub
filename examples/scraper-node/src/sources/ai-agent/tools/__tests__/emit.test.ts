import { emitOrg, type ReportState } from '../emit'
import { AsyncQueue } from '../../async-queue'
import type { OrgData, SearchQuery } from '../../../../types'

function makeFixtures(query: Partial<SearchQuery> = {}) {
    const queue = new AsyncQueue<OrgData>()
    const state: ReportState = { yielded: 0 }
    const fullQuery: SearchQuery = {
        query: 'адвокат',
        city: undefined,
        sources: [],
        maxResults: 100,
        ...query,
    }
    return { queue, state, query: fullQuery }
}

describe('emitOrg — base behavior (no city filter)', () => {
    it('accepts a complete org and increments yielded', () => {
        const { queue, state, query } = makeFixtures()
        const ok = emitOrg(
            { name: 'X', phone: '+7-000', address: 'somewhere' },
            queue, state, query, 'src',
        )
        expect(ok).toBe(true)
        expect(state.yielded).toBe(1)
    })

    it('rejects orgs missing a name', () => {
        const { queue, state, query } = makeFixtures()
        expect(emitOrg({ name: '', phone: '+7' }, queue, state, query, 'src')).toBe(false)
        expect(state.yielded).toBe(0)
    })

    it('rejects orgs with no contact channel at all', () => {
        const { queue, state, query } = makeFixtures()
        expect(emitOrg({ name: 'X' }, queue, state, query, 'src')).toBe(false)
    })

    it('respects maxResults cap', () => {
        const { queue, state, query } = makeFixtures({ maxResults: 1 })
        emitOrg({ name: 'A', phone: '+7' }, queue, state, query, 'src')
        const ok = emitOrg({ name: 'B', phone: '+7' }, queue, state, query, 'src')
        expect(ok).toBe(false)
    })
})

describe('emitOrg — city filter', () => {
    it('accepts an org whose address contains the target city stem', () => {
        const { queue, state, query } = makeFixtures({ city: 'Санкт-Петербург' })
        const ok = emitOrg(
            { name: 'X', address: 'г. Санкт-Петербург, ул. Невский, 1' },
            queue, state, query, 'src',
        )
        expect(ok).toBe(true)
    })

    it('accepts a declined-form address (locative)', () => {
        const { queue, state, query } = makeFixtures({ city: 'Санкт-Петербург' })
        const ok = emitOrg(
            { name: 'X', address: 'находится в Санкт-Петербурге' },
            queue, state, query, 'src',
        )
        expect(ok).toBe(true)
    })

    it('accepts a genitive-form address', () => {
        const { queue, state, query } = makeFixtures({ city: 'Москва' })
        const ok = emitOrg(
            { name: 'X', address: 'центр Москвы' },
            queue, state, query, 'src',
        )
        expect(ok).toBe(true)
    })

    it('rejects an address from a different city', () => {
        const { queue, state, query } = makeFixtures({ city: 'Санкт-Петербург' })
        const ok = emitOrg(
            { name: 'X', address: 'г. Воронеж, ул. Мира, 10' },
            queue, state, query, 'src',
        )
        expect(ok).toBe(false)
        expect(state.yielded).toBe(0)
    })

    it('accepts phone-only orgs without an address even when city is set', () => {
        const { queue, state, query } = makeFixtures({ city: 'Санкт-Петербург' })
        const ok = emitOrg(
            { name: 'X', phone: '+7-812-000-0000', address: null },
            queue, state, query, 'src',
        )
        expect(ok).toBe(true)
    })

    it('does not filter when no target city was set', () => {
        const { queue, state, query } = makeFixtures()
        const ok = emitOrg(
            { name: 'X', address: 'г. Воронеж, ул. Мира' },
            queue, state, query, 'src',
        )
        expect(ok).toBe(true)
    })

    it('short city names match nominative form but not declensions (precision over coverage)', () => {
        // "Уфа" stem stays as the literal "уфа" (the trim is skipped for
        // names ≤6 chars to avoid over-matching like "уф" hitting
        // "уфология"). Trade-off: "уфы"/"уфе" don't match. Documented so
        // a future edit is aware of it.
        const matches = makeFixtures({ city: 'Уфа' })
        expect(emitOrg(
            { name: 'X', address: 'г. Уфа, ул. Ленина' }, matches.queue, matches.state, matches.query, 'src',
        )).toBe(true)

        const declined = makeFixtures({ city: 'Уфа' })
        expect(emitOrg(
            { name: 'Y', address: 'центр Уфы' }, declined.queue, declined.state, declined.query, 'src',
        )).toBe(false)
    })
})
