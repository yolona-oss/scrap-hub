import { validateAndNormalizeAddress } from '../emit'

describe('validateAndNormalizeAddress — accepts real addresses', () => {
    it('full address with г. and ул.', () => {
        const r = validateAndNormalizeAddress('г. Санкт-Петербург, ул. Пушкина, д. 12', 'Санкт-Петербург')
        expect(r).toBe('г. Санкт-Петербург, ул. Пушкина, д. 12')
    })

    it('address with city no г.-prefix and a street', () => {
        const r = validateAndNormalizeAddress('Санкт-Петербург, Невский пр., 28', 'Санкт-Петербург')
        expect(r).toBe('Санкт-Петербург, Невский пр., 28')
    })

    it('partial address — street only — gets city deduced', () => {
        const r = validateAndNormalizeAddress('Невский пр., 28', 'Санкт-Петербург')
        expect(r).toBe('г. Санкт-Петербург, Невский пр., 28')
    })

    it('partial address — БЦ marker — gets city deduced', () => {
        const r = validateAndNormalizeAddress('БЦ Ренессанс, 5 этаж', 'Санкт-Петербург')
        expect(r).toBe('г. Санкт-Петербург, БЦ Ренессанс, 5 этаж')
    })

    it('partial address — дом N pattern — gets city deduced', () => {
        const r = validateAndNormalizeAddress('ул. Тверская, д. 7', 'Москва')
        expect(r).toBe('г. Москва, ул. Тверская, д. 7')
    })

    it('bare city matching queryCity — minimal canonical form', () => {
        const r = validateAndNormalizeAddress('Санкт-Петербург', 'Санкт-Петербург')
        expect(r).toBe('г. Санкт-Петербург')
    })

    it('declined city + street is accepted (city stem matches)', () => {
        const r = validateAndNormalizeAddress('в Санкт-Петербурге, ул. Мира, 5', 'Санкт-Петербург')
        expect(r).toContain('Санкт-Петербург')
        expect(r).toContain('Мира')
    })
})

describe('validateAndNormalizeAddress — rejects non-addresses', () => {
    it('rejects URL', () => {
        expect(validateAndNormalizeAddress('https://example.com/contacts', 'Санкт-Петербург')).toBeNull()
    })

    it('rejects bare-domain URL', () => {
        expect(validateAndNormalizeAddress('www.example.com', 'Санкт-Петербург')).toBeNull()
    })

    it('rejects email', () => {
        expect(validateAndNormalizeAddress('info@example.ru', 'Санкт-Петербург')).toBeNull()
    })

    it('rejects phone number', () => {
        expect(validateAndNormalizeAddress('+7 (812) 123-45-67', 'Санкт-Петербург')).toBeNull()
    })

    it('rejects breadcrumb', () => {
        expect(validateAndNormalizeAddress('Главная > О нас > Контакты', 'Санкт-Петербург')).toBeNull()
    })

    it('rejects HTML markup', () => {
        expect(validateAndNormalizeAddress('<div>some content</div>', 'Санкт-Петербург')).toBeNull()
    })

    it('rejects vague city-only description', () => {
        expect(validateAndNormalizeAddress('центр Москвы', 'Москва')).toBeNull()
    })

    it('rejects very short strings', () => {
        expect(validateAndNormalizeAddress('abc', 'Санкт-Петербург')).toBeNull()
    })
})

describe('validateAndNormalizeAddress — off-target city', () => {
    it('rejects address from a different city', () => {
        const r = validateAndNormalizeAddress('г. Москва, ул. Тверская, 7', 'Санкт-Петербург')
        expect(r).toBeNull()
    })

    it('accepts address with target city when other-city pattern is absent', () => {
        const r = validateAndNormalizeAddress('Санкт-Петербург, ул. Мира, 5', 'Санкт-Петербург')
        expect(r).not.toBeNull()
    })
})

describe('validateAndNormalizeAddress — no queryCity', () => {
    it('accepts address with street marker, no deduction', () => {
        const r = validateAndNormalizeAddress('ул. Пушкина, 12')
        expect(r).toBe('ул. Пушкина, 12')
    })

    it('rejects bare city without queryCity to compare against', () => {
        const r = validateAndNormalizeAddress('Москва')
        expect(r).toBeNull()
    })
})
