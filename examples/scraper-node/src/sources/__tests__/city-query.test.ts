import { normalizeSearchQuery } from '../city-query'

describe('normalizeSearchQuery — no target city', () => {
    it('returns the raw query unchanged when targetCity is undefined', () => {
        expect(normalizeSearchQuery('адвокат')).toBe('адвокат')
    })

    it('returns the raw query unchanged when targetCity is empty string', () => {
        expect(normalizeSearchQuery('адвокат', '')).toBe('адвокат')
    })

    it('returns the raw query unchanged when targetCity is whitespace', () => {
        expect(normalizeSearchQuery('адвокат', '   ')).toBe('адвокат')
    })

    it('trims whitespace on the raw query', () => {
        expect(normalizeSearchQuery('  адвокат  ')).toBe('адвокат')
    })
})

describe('normalizeSearchQuery — with target city', () => {
    it('appends the target city when raw query has no city', () => {
        expect(normalizeSearchQuery('адвокат', 'Санкт-Петербург')).toBe('адвокат Санкт-Петербург')
    })

    it('strips a different known city and appends the target', () => {
        expect(normalizeSearchQuery('адвокат Москва', 'Санкт-Петербург'))
            .toBe('адвокат Санкт-Петербург')
    })

    it('strips a declined-form city ("в Москве") and appends the target', () => {
        expect(normalizeSearchQuery('адвокат в Москве', 'Санкт-Петербург'))
            .toBe('адвокат в Санкт-Петербург')
    })

    it('strips the target city itself if already present (any form)', () => {
        // Model included the right city in declined form; strip + re-append
        // ensures the search uses the canonical nominative form.
        expect(normalizeSearchQuery('адвокат Санкт-Петербурге', 'Санкт-Петербург'))
            .toBe('адвокат Санкт-Петербург')
    })

    it('strips multi-word cities ("Нижний Новгород")', () => {
        expect(normalizeSearchQuery('юрист Нижний Новгород', 'Санкт-Петербург'))
            .toBe('юрист Санкт-Петербург')
    })

    it('handles hyphenated cities ("Ростов-на-Дону")', () => {
        expect(normalizeSearchQuery('адвокат Ростов-на-Дону', 'Санкт-Петербург'))
            .toBe('адвокат Санкт-Петербург')
    })

    it('preserves the topic when only the city changes', () => {
        expect(normalizeSearchQuery('юридические услуги Казань', 'Москва'))
            .toBe('юридические услуги Москва')
    })

    it('returns just the target city when raw query is empty', () => {
        expect(normalizeSearchQuery('', 'Санкт-Петербург')).toBe('Санкт-Петербург')
    })

    it('returns just the target city when raw query is only an other-city token', () => {
        expect(normalizeSearchQuery('Москва', 'Санкт-Петербург')).toBe('Санкт-Петербург')
    })

    it('strips multiple cities mentioned in one query', () => {
        expect(normalizeSearchQuery('адвокат Москва Казань', 'Санкт-Петербург'))
            .toBe('адвокат Санкт-Петербург')
    })

    it('does not strip non-city Cyrillic words', () => {
        // Ensure the heuristic doesn't eat real topic vocabulary.
        expect(normalizeSearchQuery('хороший адвокат', 'Санкт-Петербург'))
            .toBe('хороший адвокат Санкт-Петербург')
    })

    it('case-insensitive city match', () => {
        expect(normalizeSearchQuery('адвокат МОСКВА', 'Санкт-Петербург'))
            .toBe('адвокат Санкт-Петербург')
        expect(normalizeSearchQuery('адвокат москва', 'Санкт-Петербург'))
            .toBe('адвокат Санкт-Петербург')
    })

    it('handles target cities not in the known list', () => {
        // User-provided custom city that's not in KNOWN_RUSSIAN_CITIES still
        // gets appended — only the *stripping* relies on the known list.
        expect(normalizeSearchQuery('адвокат', 'Тында')).toBe('адвокат Тында')
    })
})
