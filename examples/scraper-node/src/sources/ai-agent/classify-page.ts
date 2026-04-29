import * as cheerio from 'cheerio'
import { httpGet } from '../http'
import { matchAggregator } from './aggregator-registry'
import { scoreContactLink, scoreAggregatorLink } from './link-scorers'
import { log } from '@cmd-hub/common'
import type { ClassifiedPage, PageType, ScoredLink, Block } from './page-types'

const TOP_K_LINKS = 5

interface ClassificationDraft {
    pageType: PageType
    confidence: number
    signals: string[]
}

function parseJsonLd($: cheerio.CheerioAPI): unknown[] {
    const blobs: unknown[] = []
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text().trim()
        if (!raw) return
        try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) blobs.push(...parsed)
            else blobs.push(parsed)
        } catch {
            // Malformed JSON-LD is common in the wild; we ignore and proceed.
        }
    })
    return blobs
}

function isLocalBusiness(blob: unknown): boolean {
    if (!blob || typeof blob !== 'object') return false
    const t = (blob as any)['@type']
    if (typeof t === 'string') return /LocalBusiness|Organization|MedicalBusiness|Dentist/i.test(t)
    if (Array.isArray(t)) return t.some(x => typeof x === 'string' && /LocalBusiness|Organization|MedicalBusiness|Dentist/i.test(x))
    return false
}

function parseNextData($: cheerio.CheerioAPI): unknown | undefined {
    const raw = $('script#__NEXT_DATA__').contents().text().trim()
    if (!raw) return undefined
    try {
        return JSON.parse(raw)
    } catch {
        return undefined
    }
}

function buildCleanedText($: cheerio.CheerioAPI): string {
    const $clone = cheerio.load($.html())
    $clone('script, style, noscript').remove()
    return $clone('body').text().replace(/\s+/g, ' ').trim()
}

function buildCandidateBlocks($: cheerio.CheerioAPI): Block[] {
    const blocks: Block[] = []
    for (const sel of ['header', 'footer', '[class*="contact"]', '[class*="footer"]']) {
        $(sel).each((_, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim()
            if (!text) return
            const tels: string[] = []
            const mails: string[] = []
            $(el).find('a[href^="tel:"]').each((_, a) => {
                const h = $(a).attr('href')
                if (h) tels.push(h.replace(/^tel:/i, '').trim())
            })
            $(el).find('a[href^="mailto:"]').each((_, a) => {
                const h = $(a).attr('href')
                if (h) mails.push(h.replace(/^mailto:/i, '').trim())
            })
            blocks.push({ selector: sel, text, tels, mails })
        })
    }
    return blocks
}

function discoverLinks(
    $: cheerio.CheerioAPI,
    baseUrl: string,
): { contacts: ScoredLink[], aggregators: ScoredLink[] } {
    const contacts: ScoredLink[] = []
    const aggregators: ScoredLink[] = []
    const seenContact = new Set<string>()
    const seenAggregator = new Set<string>()

    $('a[href]').each((_, el) => {
        const $a = $(el)
        const c = scoreContactLink($a, baseUrl)
        if (c && !seenContact.has(c.url)) {
            seenContact.add(c.url)
            contacts.push(c)
        }
        const a = scoreAggregatorLink($a, baseUrl)
        if (a && !seenAggregator.has(a.url)) {
            seenAggregator.add(a.url)
            aggregators.push(a)
        }
    })

    contacts.sort((a, b) => b.score - a.score)
    aggregators.sort((a, b) => b.score - a.score)
    return {
        contacts: contacts.slice(0, TOP_K_LINKS),
        aggregators: aggregators.slice(0, TOP_K_LINKS),
    }
}

function classifyShape(
    url: string,
    $: cheerio.CheerioAPI,
    jsonLd: unknown[],
): ClassificationDraft {
    const signals: string[] = []
    const localBusinessCount = jsonLd.filter(isLocalBusiness).length

    const aggregatorEntry = matchAggregator(url)
    const onAggregatorDomain = aggregatorEntry !== null
    if (onAggregatorDomain) signals.push(`registry:${aggregatorEntry.domain}`)

    if (localBusinessCount >= 3) signals.push(`jsonld-localbusiness:${localBusinessCount}`)
    else if (localBusinessCount === 1) signals.push('jsonld-localbusiness:1')

    const cardCount = $('article, [class*="card"]').length
    if (cardCount >= 5) signals.push(`cards:${cardCount}`)

    const hasPagination = $('a[href*="page="], [class*="pagination"] a').length > 0
    if (hasPagination) signals.push('pagination')

    const breadcrumb = $('nav, [class*="breadcrumb"]').first().text()
    const breadcrumbDeep = breadcrumb.split('/').filter(s => s.trim()).length >= 3
    if (breadcrumbDeep) signals.push('breadcrumb-deep')

    let path = ''
    try { path = new URL(url).pathname } catch { /* ignore */ }
    const pathLooksList = /\/(catalog|firms|companies|listings|directory|каталог|справочник)/i.test(path)
    if (pathLooksList) signals.push('path-list-shaped')

    // SERP: many cards or many LocalBusiness + (pagination or list-shaped path) — typically on aggregator
    if (
        (localBusinessCount >= 3 || cardCount >= 5) &&
        (hasPagination || pathLooksList || onAggregatorDomain)
    ) {
        return { pageType: 'aggregator-serp', confidence: 0.85, signals }
    }

    // Detail: 1 LocalBusiness on aggregator domain with deep breadcrumb
    if (localBusinessCount === 1 && onAggregatorDomain && breadcrumbDeep) {
        return { pageType: 'aggregator-detail', confidence: 0.85, signals }
    }

    // Landing: aggregator domain, root path or shallow, no business records
    if (onAggregatorDomain && localBusinessCount === 0 && (path === '/' || path.length <= 5)) {
        return { pageType: 'aggregator-landing', confidence: 0.8, signals }
    }

    // Org site: not on aggregator domain, has tel:/mailto: links or has 1 LocalBusiness
    const hasTel = $('a[href^="tel:"]').length > 0
    const hasMail = $('a[href^="mailto:"]').length > 0
    if (!onAggregatorDomain && (hasTel || hasMail || localBusinessCount === 1)) {
        if (hasTel) signals.push('tel-link')
        if (hasMail) signals.push('mailto-link')
        return { pageType: 'org-site', confidence: 0.75, signals }
    }

    return { pageType: 'other', confidence: 0.5, signals }
}

/** Pure function over an HTML string — easy to unit-test against fixtures. */
export function classifyPageFromHtml(url: string, html: string): ClassifiedPage {
    const $ = cheerio.load(html)
    const jsonLd = parseJsonLd($)
    const nextData = parseNextData($)
    const draft = classifyShape(url, $, jsonLd)
    const cleanedText = buildCleanedText($)
    const candidateBlocks = buildCandidateBlocks($)
    const { contacts, aggregators } = discoverLinks($, url)

    return {
        url,
        pageType: draft.pageType,
        confidence: draft.confidence,
        signals: draft.signals,
        cleanedText,
        candidateBlocks,
        jsonLdBlobs: jsonLd,
        nextDataBlob: nextData,
        contactCandidates: contacts,
        aggregatorCandidates: aggregators,
        branchCandidates: [], // Branch enumeration deferred to PR4
    }
}

/** Network-fetching wrapper. Same-shape return as the pure variant. */
export async function classifyPage(
    url: string,
    opts?: { signal?: AbortSignal },
): Promise<ClassifiedPage> {
    log.trace(`ai-agent.classifyPage: ${url}`)
    const res = await httpGet(url, {
        headers: { 'Accept': 'text/html,application/xhtml+xml' },
        validateStatus: s => s < 600,
        signal: opts?.signal,
    })
    if (res.status >= 400) {
        return {
            url,
            pageType: 'other',
            confidence: 0,
            signals: [`http-${res.status}`],
            cleanedText: '',
            candidateBlocks: [],
            jsonLdBlobs: [],
            contactCandidates: [],
            aggregatorCandidates: [],
            branchCandidates: [],
        }
    }
    const html = typeof res.data === 'string' ? res.data : String(res.data ?? '')
    return classifyPageFromHtml(url, html)
}
