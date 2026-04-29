import { wrapAsOrgData } from '../types'

describe('wrapAsOrgData', () => {
    it('wraps a singular legacy record into v2 shape', () => {
        const r = wrapAsOrgData({
            name: 'Acme',
            phone: '+78121001010',
            email: 'info@acme.ru',
            address: 'ул. Ленина, 1',
            url: 'https://acme.ru/',
            source: 'yandex-business',
        })
        expect(r.name).toBe('Acme')
        expect(r.phones).toEqual(['+78121001010'])
        expect(r.emails).toEqual(['info@acme.ru'])
        expect(r.addresses).toEqual(['ул. Ленина, 1'])
        expect(r.sources).toHaveLength(1)
        expect(r.sources[0].kind).toBe('aggregator-detail')
        expect(r.sources[0].url).toBe('https://acme.ru/')
        expect(r.status).toBe('partial')
        expect(r.confidence).toBe(1.0)
        expect(r.extractionMethod).toBe('deterministic')
    })

    it('drops null contact fields', () => {
        const r = wrapAsOrgData({
            name: 'X', phone: null, email: null, address: null, source: 'fake',
        })
        expect(r.phones).toEqual([])
        expect(r.emails).toEqual([])
        expect(r.addresses).toEqual([])
        expect(r.sources).toHaveLength(0)
    })

    it('respects optional kind override', () => {
        const r = wrapAsOrgData({
            name: 'X', phone: '+7', email: null, address: null,
            url: 'https://x', source: 'web-search',
        }, { kind: 'web-search' })
        expect(r.sources[0].kind).toBe('web-search')
    })
})
