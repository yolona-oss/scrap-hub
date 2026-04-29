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
