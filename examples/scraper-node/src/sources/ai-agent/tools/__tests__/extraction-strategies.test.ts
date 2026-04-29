import * as cheerio from 'cheerio'
import {
    extractFromJsonLd,
    extractFromMicrodata,
    extractFromSemanticHtml,
    extractFromRegex,
} from '../extraction-strategies'

describe('extractFromJsonLd', () => {
    it('extracts name, telephone, email, address from a LocalBusiness blob', () => {
        const blob = {
            '@type': 'LocalBusiness',
            name: 'Стом-Клиника А',
            telephone: '+7 (812) 100-10-10',
            email: 'info@clinic-a.ru',
            address: { '@type': 'PostalAddress', streetAddress: 'ул. Ленина, 1' },
        }
        const r = extractFromJsonLd([blob])
        expect(r.candidateName).toBe('Стом-Клиника А')
        expect(r.phones).toContain('+78121001010')
        expect(r.emails).toContain('info@clinic-a.ru')
        expect(r.addresses?.[0]).toMatch(/Ленина/)
    })

    it('handles an array of LocalBusiness blobs', () => {
        const blobs = [
            { '@type': 'LocalBusiness', name: 'A', telephone: '+78121001010' },
            { '@type': 'LocalBusiness', name: 'B', telephone: '+78122002020' },
        ]
        const r = extractFromJsonLd(blobs)
        expect(r.phones).toEqual(expect.arrayContaining(['+78121001010', '+78122002020']))
    })

    it('returns empty result when no LocalBusiness present', () => {
        const r = extractFromJsonLd([{ '@type': 'WebPage' }])
        expect(r.phones ?? []).toHaveLength(0)
    })

    it('handles malformed entries without throwing', () => {
        expect(() => extractFromJsonLd([null, undefined, 'string', 42])).not.toThrow()
    })
})

describe('extractFromMicrodata', () => {
    it('extracts itemprop="address"', () => {
        const $ = cheerio.load('<div itemprop="address">ул. Тверская, 7</div>')
        const r = extractFromMicrodata($)
        expect(r.addresses).toContain('ул. Тверская, 7')
    })

    it('extracts itemprop="telephone"', () => {
        const $ = cheerio.load('<span itemprop="telephone">+7 (812) 100-10-10</span>')
        const r = extractFromMicrodata($)
        expect(r.phones?.length).toBeGreaterThan(0)
    })

    it('extracts itemprop="name" as candidate name', () => {
        const $ = cheerio.load('<h1 itemprop="name">Acme Clinic</h1>')
        const r = extractFromMicrodata($)
        expect(r.candidateName).toBe('Acme Clinic')
    })
})

describe('extractFromSemanticHtml', () => {
    it('extracts tel: anchors', () => {
        const $ = cheerio.load('<a href="tel:+78121001010">Call</a>')
        const r = extractFromSemanticHtml($)
        expect(r.phones).toContain('+78121001010')
    })

    it('extracts mailto: anchors and lowercases', () => {
        const $ = cheerio.load('<a href="mailto:Info@X.RU">Email</a>')
        const r = extractFromSemanticHtml($)
        expect(r.emails).toContain('info@x.ru')
    })

    it('extracts text inside <address>', () => {
        const $ = cheerio.load('<address>г. Санкт-Петербург, ул. Ленина, 1</address>')
        const r = extractFromSemanticHtml($)
        expect(r.addresses?.[0]).toMatch(/Ленина/)
    })
})

describe('extractFromRegex', () => {
    it('extracts +7 phone from cleaned text', () => {
        const r = extractFromRegex('Звоните +7 (812) 100-10-10 или пишите.')
        expect(r.phones?.length).toBeGreaterThan(0)
    })

    it('extracts email from cleaned text', () => {
        const r = extractFromRegex('Email: hello@test.ru thanks')
        expect(r.emails).toContain('hello@test.ru')
    })

    it('extracts Russian-style address pattern', () => {
        const r = extractFromRegex('Наш адрес: ул. Пушкина, 12 — приходите.')
        expect(r.addresses?.[0]).toMatch(/Пушкина/)
    })

    it('returns empty arrays for blank input', () => {
        const r = extractFromRegex('')
        expect(r.phones ?? []).toHaveLength(0)
    })
})
