import { matchAggregator, listAggregators, type AggregatorEntry } from '../aggregator-registry'

describe('aggregator-registry', () => {
    it('matches a known top-level aggregator domain', () => {
        const m = matchAggregator('https://zoon.ru/spb/medical/')
        expect(m).not.toBeNull()
        expect(m?.domain).toBe('zoon.ru')
        expect(m?.confidence).toBe(1.0)
    })

    it('matches a path-prefixed entry like yandex.ru/maps', () => {
        const m = matchAggregator('https://yandex.ru/maps/2/saint-petersburg/search/')
        expect(m?.domain).toBe('yandex.ru/maps')
    })

    it('does not match a yandex.ru subpath that is not /maps', () => {
        expect(matchAggregator('https://yandex.ru/news/')).toBeNull()
    })

    it('returns null for unknown domains', () => {
        expect(matchAggregator('https://acme-clinic.ru/')).toBeNull()
    })

    it('handles www. prefix transparently', () => {
        const m = matchAggregator('https://www.zoon.ru/')
        expect(m?.domain).toBe('zoon.ru')
    })

    it('lists all aggregator entries', () => {
        const list = listAggregators()
        expect(Array.isArray(list)).toBe(true)
        expect(list.length).toBeGreaterThanOrEqual(8)
        expect(list.every((e: AggregatorEntry) =>
            typeof e.domain === 'string' && typeof e.confidence === 'number'
        )).toBe(true)
    })

    it('returns a defensive copy from listAggregators', () => {
        const a = listAggregators()
        const b = listAggregators()
        expect(a).not.toBe(b)
    })

    it('rejects malformed input gracefully', () => {
        expect(matchAggregator('not-a-url')).toBeNull()
        expect(matchAggregator('')).toBeNull()
    })

    it('does not match a path that shares a prefix but a different segment', () => {
        // entry: yandex.ru/maps must NOT match yandex.ru/mapsomething/...
        expect(matchAggregator('https://yandex.ru/mapsomething/foo')).toBeNull()
    })
})
