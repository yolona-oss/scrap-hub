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

describe('extract_contacts — strategy reporting', () => {
    const tool = makeExtractContactsTool()

    it('reports jsonld when JSON-LD LocalBusiness is present', async () => {
        const html = `
            <html><body>
                <script type="application/ld+json">
                {"@type":"LocalBusiness","name":"X","telephone":"+78121001010"}
                </script>
            </body></html>
        `
        const r = await tool.handler({ html })
        expect(r.strategiesFired).toEqual(expect.arrayContaining(['jsonld']))
    })

    it('reports semantic-html for tel: links', async () => {
        const html = `<html><body><a href="tel:+78121001010">x</a></body></html>`
        const r = await tool.handler({ html })
        expect(r.strategiesFired).toEqual(expect.arrayContaining(['semantic-html']))
    })

    it('reports regex when phones come only from body text', async () => {
        const html = `<html><body><p>Call +7 (812) 100-10-10 today</p></body></html>`
        const r = await tool.handler({ html })
        expect(r.strategiesFired).toEqual(expect.arrayContaining(['regex']))
    })

    it('records multiple strategies when several fired', async () => {
        const html = `
            <html><body>
                <script type="application/ld+json">
                {"@type":"LocalBusiness","name":"X","telephone":"+78121001010"}
                </script>
                <a href="mailto:a@b.ru">m</a>
            </body></html>
        `
        const r = await tool.handler({ html })
        expect(r.strategiesFired?.length).toBeGreaterThanOrEqual(2)
    })

    it('omits strategiesFired field when html is empty', async () => {
        const r = await tool.handler({ html: '' })
        expect(r.error).toBe('empty html')
        expect(r.strategiesFired).toBeUndefined()
    })
})

describe('extract_contacts — extractor escalation', () => {
    function fakeRunner(report: any) {
        return jest.fn().mockResolvedValue({
            outcome: report.outcome,
            phones: report.phones ?? [],
            emails: report.emails ?? [],
            addresses: report.addresses ?? [],
            candidateName: report.candidateName ?? '',
            confidence: report.confidence ?? 0.5,
            reason: report.reason,
            toolCallsUsed: 1,
        })
    }

    it('does not escalate when deterministic extraction succeeds', async () => {
        const runner = jest.fn()
        const tool = makeExtractContactsTool({ extractorRunner: runner })
        const html = `<html><body><a href="tel:+78121001010">x</a></body></html>`
        const r = await tool.handler({ html })
        expect(runner).not.toHaveBeenCalled()
        expect(r.phones).toContain('+78121001010')
    })

    it('escalates when zero contacts on substantive page', async () => {
        const runner = fakeRunner({
            outcome: 'extraction', phones: ['+78122002020'], candidateName: 'X', confidence: 0.7,
        })
        const tool = makeExtractContactsTool({ extractorRunner: runner })
        const longText = 'About us, our story, '.repeat(60)  // >500 chars
        const html = `<html><body><div>${longText}</div></body></html>`
        const r = await tool.handler({ html })
        expect(runner).toHaveBeenCalledTimes(1)
        expect(r.phones).toContain('+78122002020')
        expect(r.strategiesFired).toEqual(expect.arrayContaining(['extractor-llm']))
    })

    it('does not escalate on thin pages (text < 500 chars)', async () => {
        const runner = jest.fn()
        const tool = makeExtractContactsTool({ extractorRunner: runner })
        const html = `<html><body><p>tiny page</p></body></html>`
        await tool.handler({ html })
        expect(runner).not.toHaveBeenCalled()
    })

    it('does not escalate when no runner provided (escalation disabled)', async () => {
        const tool = makeExtractContactsTool()
        const longText = 'About us, our story, '.repeat(60)
        const html = `<html><body><div>${longText}</div></body></html>`
        const r = await tool.handler({ html })
        expect(r.phones).toEqual([])  // no contacts; no escalation
    })

    it('extractor incomplete result does not pollute output', async () => {
        const runner = fakeRunner({ outcome: 'incomplete', reason: 'no markers' })
        const tool = makeExtractContactsTool({ extractorRunner: runner })
        const longText = 'A'.repeat(600)
        const html = `<html><body><div>${longText}</div></body></html>`
        const r = await tool.handler({ html })
        expect(r.phones).toEqual([])
        expect(r.strategiesFired).not.toEqual(expect.arrayContaining(['extractor-llm']))
    })
})
