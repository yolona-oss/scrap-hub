import * as cheerio from 'cheerio'
import { scoreContactLink, scoreAggregatorLink } from '../link-scorers'

const BASE = 'https://acme-clinic.ru/'

describe('scoreContactLink', () => {
    it('scores a /contacts path link high', () => {
        const $ = cheerio.load(`<html><body><footer><a href="/contacts">Контакты</a></footer></body></html>`)
        const $a = $('a').first()
        const link = scoreContactLink($a, BASE)
        expect(link).not.toBeNull()
        expect(link!.score).toBeGreaterThan(0.8)
        expect(link!.kind).toBe('contact-page')
        expect(link!.url).toBe('https://acme-clinic.ru/contacts')
    })

    it('scores Cyrillic /контакты path with anchor text', () => {
        const $ = cheerio.load(`<html><body><a href="/контакты">Связаться</a></body></html>`)
        const $a = $('a').first()
        const link = scoreContactLink($a, BASE)
        expect(link).not.toBeNull()
        expect(link!.score).toBeGreaterThanOrEqual(0.6)
    })

    it('rejects cross-origin contact links', () => {
        const $ = cheerio.load(`<html><body><a href="https://other-site.ru/contacts">Contacts</a></body></html>`)
        const $a = $('a').first()
        expect(scoreContactLink($a, BASE)).toBeNull()
    })

    it('returns null for a link below threshold', () => {
        const $ = cheerio.load(`<html><body><a href="/random">Random</a></body></html>`)
        const $a = $('a').first()
        expect(scoreContactLink($a, BASE)).toBeNull()
    })

    it('boosts links inside <footer>', () => {
        const $f = cheerio.load(`<html><body><footer><a href="/about">О нас</a></footer></body></html>`)
        const linkInFooter = scoreContactLink($f('a').first(), BASE)
        const $h = cheerio.load(`<html><body><a href="/about">О нас</a></body></html>`)
        const linkPlain = scoreContactLink($h('a').first(), BASE)
        expect(linkInFooter).not.toBeNull()
        // /about scores 0.6 base + 0.3 anchor (О нас does NOT match) => 0.6
        // in footer: +0.2 => 0.8 vs plain 0.6
        expect(linkInFooter!.score).toBeGreaterThan(linkPlain?.score ?? 0)
    })

    it('skips anchors with empty href', () => {
        const $ = cheerio.load(`<html><body><a>No href</a></body></html>`)
        const $a = $('a').first()
        expect(scoreContactLink($a, BASE)).toBeNull()
    })
})

describe('scoreAggregatorLink', () => {
    it('scores a known-aggregator-domain link via registry confidence', () => {
        const $ = cheerio.load(`<html><body><a href="https://zoon.ru/spb/">Каталог</a></body></html>`)
        const $a = $('a').first()
        const link = scoreAggregatorLink($a, BASE)
        expect(link).not.toBeNull()
        expect(link!.score).toBeGreaterThanOrEqual(0.8)
        expect(link!.kind).toBe('aggregator')
    })

    it('scores a /catalog/ path link from an unknown domain', () => {
        const $ = cheerio.load(`<html><body><a href="https://some-directory.ru/catalog/dentists">Каталог</a></body></html>`)
        const $a = $('a').first()
        const link = scoreAggregatorLink($a, BASE)
        expect(link).not.toBeNull()
        expect(link!.score).toBeGreaterThan(0.5)
    })

    it('returns null for a generic same-origin link', () => {
        const $ = cheerio.load(`<html><body><a href="/about">About</a></body></html>`)
        const $a = $('a').first()
        expect(scoreAggregatorLink($a, BASE)).toBeNull()
    })

    it('handles relative URLs by resolving against base', () => {
        const $ = cheerio.load(`<html><body><a href="/catalog/x">Каталог</a></body></html>`)
        const $a = $('a').first()
        const link = scoreAggregatorLink($a, BASE)
        // same-origin /catalog → should score path heuristic
        expect(link).not.toBeNull()
    })
})
