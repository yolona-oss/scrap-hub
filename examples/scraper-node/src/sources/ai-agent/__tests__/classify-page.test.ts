import * as fs from 'fs'
import * as path from 'path'
import { classifyPageFromHtml } from '../classify-page'

const FIXTURES = path.join(__dirname, '..', '__fixtures__')

function loadFixture(name: string): string {
    return fs.readFileSync(path.join(FIXTURES, name), 'utf-8')
}

describe('classifyPageFromHtml', () => {
    it('classifies a Zoon SERP as aggregator-serp with high confidence', () => {
        const html = loadFixture('aggregator-serp-zoon.html')
        const result = classifyPageFromHtml('https://zoon.ru/spb/medical/', html)

        expect(result.pageType).toBe('aggregator-serp')
        expect(result.confidence).toBeGreaterThan(0.7)
        expect(result.signals).toEqual(expect.arrayContaining([
            expect.stringMatching(/jsonld-localbusiness/),
        ]))
        expect(result.jsonLdBlobs.length).toBe(3)
    })

    it('classifies a Zoon detail page as aggregator-detail', () => {
        const html = loadFixture('aggregator-detail-zoon.html')
        const result = classifyPageFromHtml('https://zoon.ru/spb/medical/clinic-a/', html)

        expect(result.pageType).toBe('aggregator-detail')
        expect(result.jsonLdBlobs.length).toBe(1)
    })

    it('classifies a Zoon homepage as aggregator-landing', () => {
        const html = loadFixture('aggregator-landing-zoon.html')
        const result = classifyPageFromHtml('https://zoon.ru/', html)

        expect(result.pageType).toBe('aggregator-landing')
    })

    it('classifies an org-site clinic page', () => {
        const html = loadFixture('org-site-clinic.html')
        const result = classifyPageFromHtml('https://clinic-a.ru/', html)

        expect(result.pageType).toBe('org-site')
        expect(result.contactCandidates.length).toBeGreaterThanOrEqual(1)
        expect(result.contactCandidates.some(c => c.url === 'https://clinic-a.ru/contacts')).toBe(true)
    })

    it('classifies a long blog post as other', () => {
        const html = loadFixture('other-blog-post.html')
        const result = classifyPageFromHtml('https://blog.example.com/dentist-tips/', html)

        expect(result.pageType).toBe('other')
    })

    it('populates cleanedText for downstream extraction', () => {
        const html = loadFixture('org-site-clinic.html')
        const result = classifyPageFromHtml('https://clinic-a.ru/', html)
        expect(result.cleanedText.length).toBeGreaterThan(0)
        expect(result.cleanedText).not.toContain('<')  // tags stripped
    })

    it('extracts aggregator candidate links from an org page that links to zoon', () => {
        const html = `<html><body>
            <main>About us.</main>
            <footer><a href="https://zoon.ru/spb/medical/clinic-a/">Мы на Zoon</a></footer>
        </body></html>`
        const result = classifyPageFromHtml('https://clinic-a.ru/', html)
        expect(result.aggregatorCandidates.some(c => c.url.startsWith('https://zoon.ru/'))).toBe(true)
    })
})
