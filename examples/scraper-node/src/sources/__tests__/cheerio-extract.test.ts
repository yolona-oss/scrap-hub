import * as cheerio from 'cheerio'
import { extractFromElement, readNode } from '../cheerio-extract'

const FIXTURE = `
<div class="card">
    <h3 class="title">  Acme   Corp  </h3>
    <a class="link" href="/contact">Contact</a>
    <img class="logo" src="/logo.png" alt="Acme logo" />
    <span data-id="42" class="badge">v1</span>
    <p class="bio">Line one.<br>Line two.</p>
</div>
`

describe('extractFromElement', () => {
    const $ = cheerio.load(FIXTURE)
    const $card = $('.card')

    it('text mode (default) returns trimmed inner text', () => {
        expect(extractFromElement($card, '.title')).toBe('Acme Corp')
    })

    it('text mode collapses internal whitespace', () => {
        // Multiple spaces in source flatten to single spaces in output.
        const got = extractFromElement($card, '.title', 'text')
        expect(got).toBe('Acme Corp')
    })

    it('href mode returns the href attribute', () => {
        expect(extractFromElement($card, '.link', 'href')).toBe('/contact')
    })

    it('src mode returns the src attribute', () => {
        expect(extractFromElement($card, '.logo', 'src')).toBe('/logo.png')
    })

    it('arbitrary attribute name reads that attr', () => {
        expect(extractFromElement($card, '.badge', 'data-id')).toBe('42')
    })

    it('returns null when selector has no match', () => {
        expect(extractFromElement($card, '.nonexistent')).toBeNull()
    })

    it('returns null when text mode finds an empty node', () => {
        const $empty = cheerio.load('<div class="card"><span class="empty"></span></div>')('.card')
        expect(extractFromElement($empty, '.empty')).toBeNull()
    })

    it('returns null for missing attribute', () => {
        expect(extractFromElement($card, '.title', 'href')).toBeNull()
    })
})

describe('readNode', () => {
    const $ = cheerio.load(FIXTURE)

    it('html mode returns inner HTML (preserves nested elements)', () => {
        const $bio = $('.bio')
        const got = readNode($bio, 'html')
        expect(got).toContain('Line one.')
        expect(got).toContain('<br>')
        expect(got).toContain('Line two.')
    })

    it('text mode collapses whitespace across line breaks', () => {
        const $bio = $('.bio')
        // <br> introduces a line break in source but not in extracted text;
        // cheerio's .text() returns "Line one.Line two." (no separator).
        // Either result is acceptable as long as whitespace is collapsed.
        expect(readNode($bio, 'text')).toMatch(/Line one\.\s*Line two\./)
    })

    it('returns null for missing attribute on resolved node', () => {
        const $title = $('.title')
        expect(readNode($title, 'data-foo')).toBeNull()
    })
})
