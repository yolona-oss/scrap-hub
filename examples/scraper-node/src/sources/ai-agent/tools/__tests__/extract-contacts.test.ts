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
