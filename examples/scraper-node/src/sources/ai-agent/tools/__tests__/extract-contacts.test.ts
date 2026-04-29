import { makeExtractContactsTool } from '../extract-contacts'

describe('extract_contacts — phones and emails', () => {
    const tool = makeExtractContactsTool()

    it('extracts phones from tel: anchors', async () => {
        const html = `<html><body><a href="tel:+74951234567">Call</a></body></html>`
        const result = await tool.handler({ html })
        expect(result.phones).toContain('+74951234567')
    })

    it('extracts phones from body text via regex', async () => {
        const html = `<html><body><p>Тел: +7 (495) 123-45-67</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.phones.length).toBeGreaterThan(0)
    })

    it('normalizes 8-prefix phone to +7', async () => {
        const html = `<html><body><p>8 (495) 123-45-67</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.phones).toContain('+74951234567')
    })

    it('extracts emails from mailto: anchors and lowercases them', async () => {
        const html = `<html><body><a href="mailto:Info@Test.RU">Email</a></body></html>`
        const result = await tool.handler({ html })
        expect(result.emails).toContain('info@test.ru')
    })

    it('extracts emails from body text', async () => {
        const html = `<html><body><p>Contact: hello@example.com</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.emails).toContain('hello@example.com')
    })

    it('dedups duplicate phones across sources', async () => {
        const html = `<html><body><a href="tel:+74951234567">A</a><p>+7 (495) 123-45-67</p></body></html>`
        const result = await tool.handler({ html })
        const matches = result.phones.filter((p: string) => p === '+74951234567')
        expect(matches).toHaveLength(1)
    })
})

describe('extract_contacts — addresses', () => {
    const tool = makeExtractContactsTool()

    it('extracts address from itemprop="address"', async () => {
        const html = `<html><body><div itemprop="address">ул. Тверская, 7</div></body></html>`
        const result = await tool.handler({ html })
        expect(result.addresses).toContain('ул. Тверская, 7')
    })

    it('extracts address from itemprop="streetAddress"', async () => {
        const html = `<html><body><span itemprop="streetAddress">пр. Невский, 28</span></body></html>`
        const result = await tool.handler({ html })
        expect(result.addresses).toContain('пр. Невский, 28')
    })

    it('extracts address from .address class', async () => {
        const html = `<html><body><div class="address">ул. Арбат, д. 12</div></body></html>`
        const result = await tool.handler({ html })
        expect(result.addresses).toContain('ул. Арбат, д. 12')
    })

    it('extracts Russian address from body text via regex', async () => {
        const html = `<html><body><p>Наш офис: г. Москва, ул. Ленина, 5</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.addresses.some((a: string) => /Ленина/.test(a))).toBe(true)
    })

    it('dedups addresses across sources', async () => {
        const html = `<html><body><div class="address">ул. Тверская, 7</div><p>ул. Тверская, 7</p></body></html>`
        const result = await tool.handler({ html })
        const matches = result.addresses.filter((a: string) => a === 'ул. Тверская, 7')
        expect(matches).toHaveLength(1)
    })
})

describe('extract_contacts — candidateName', () => {
    const tool = makeExtractContactsTool()

    it('uses <title> when present', async () => {
        const html = `<html><head><title>Адвокат Иванов</title></head><body></body></html>`
        const result = await tool.handler({ html })
        expect(result.candidateName).toBe('Адвокат Иванов')
    })

    it('falls back to itemprop="name" when no title', async () => {
        const html = `<html><body><span itemprop="name">ООО Ромашка</span></body></html>`
        const result = await tool.handler({ html })
        expect(result.candidateName).toBe('ООО Ромашка')
    })

    it('falls back to <h1> when no title or itemprop', async () => {
        const html = `<html><body><h1>Юридический центр</h1></body></html>`
        const result = await tool.handler({ html })
        expect(result.candidateName).toBe('Юридический центр')
    })

    it('returns empty string when nothing matches', async () => {
        const html = `<html><body><p>Just text</p></body></html>`
        const result = await tool.handler({ html })
        expect(result.candidateName).toBe('')
    })
})

describe('extract_contacts — edge cases', () => {
    const tool = makeExtractContactsTool()

    it('returns error envelope on empty html', async () => {
        const result = await tool.handler({ html: '' })
        expect(result.error).toBe('empty html')
        expect(result.phones).toEqual([])
    })

    it('returns empty arrays on garbage html without throwing', async () => {
        const result = await tool.handler({ html: '<<<>>>' })
        expect(result.phones).toEqual([])
        expect(result.emails).toEqual([])
        expect(result.addresses).toEqual([])
    })
})

describe('extract_contacts — hint', () => {
    const tool = makeExtractContactsTool()

    it('emits "no structured contacts" hint when nothing found', async () => {
        const result = await tool.handler({ html: '<html><body>Nothing here</body></html>' })
        expect(result.hint).toMatch(/no structured contacts/i)
    })

    it('emits "found N contacts" hint when contacts found', async () => {
        const html = `<html><body><a href="tel:+74951234567">x</a></body></html>`
        const result = await tool.handler({ html })
        expect(result.hint).toMatch(/found.*report_results/i)
    })
})
