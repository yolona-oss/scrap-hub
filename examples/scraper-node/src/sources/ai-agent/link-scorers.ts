import type * as cheerio from 'cheerio'
import { matchAggregator } from './aggregator-registry'
import type { ScoredLink } from './page-types'

const CONTACT_PATH_RE = /\/(contact|контакт|kontakt|address|адрес|about|о[- _]?компании|locations|branch)/i
const CONTACT_ANCHOR_RE = /(контакт|связь|address|адрес|телефон|phone|contact)/i

const AGGREGATOR_PATH_RE = /\/(catalog|firms|companies|listings|directory|каталог|справочник)/i
const AGGREGATOR_ANCHOR_RE = /(каталог|справочник|directory|listings|companies)/i

const CONTACT_THRESHOLD = 0.3
const AGGREGATOR_THRESHOLD = 0.5

function resolveHref(href: string, baseUrl: string): string | null {
    if (!href) return null
    try {
        return new URL(href, baseUrl).toString()
    } catch {
        return null
    }
}

function isSameOrigin(a: string, b: string): boolean {
    try {
        return new URL(a).origin === new URL(b).origin
    } catch {
        return false
    }
}

function isInside($a: cheerio.Cheerio<any>, selector: string): boolean {
    return $a.closest(selector).length > 0
}

export function scoreContactLink(
    $a: cheerio.Cheerio<any>,
    _$: cheerio.CheerioAPI,
    baseUrl: string,
): ScoredLink | null {
    const href = ($a.attr('href') ?? '').trim()
    const url = resolveHref(href, baseUrl)
    if (!url) return null
    if (!isSameOrigin(url, baseUrl)) return null

    const text = ($a.text() ?? '').trim()
    let score = 0
    const reasons: string[] = []

    const path = (() => {
        try { return decodeURIComponent(new URL(url).pathname) } catch { return '' }
    })()

    if (CONTACT_PATH_RE.test(path)) { score += 0.6; reasons.push('path') }
    if (CONTACT_ANCHOR_RE.test(text)) { score += 0.3; reasons.push('anchor') }
    if (isInside($a, 'footer')) { score += 0.2; reasons.push('footer') }
    else if (isInside($a, 'header,nav')) { score += 0.1; reasons.push('header/nav') }

    if (score < CONTACT_THRESHOLD) return null

    return {
        url,
        score: Math.round(score * 100) / 100,
        reason: reasons.join('+'),
        kind: 'contact-page',
    }
}

export function scoreAggregatorLink(
    $a: cheerio.Cheerio<any>,
    _$: cheerio.CheerioAPI,
    baseUrl: string,
): ScoredLink | null {
    const href = ($a.attr('href') ?? '').trim()
    const url = resolveHref(href, baseUrl)
    if (!url) return null

    const text = ($a.text() ?? '').trim()
    let score = 0
    const reasons: string[] = []

    const matched = matchAggregator(url)
    if (matched) {
        score += matched.confidence
        reasons.push(`registry:${matched.domain}`)
    } else {
        const path = (() => {
            try { return decodeURIComponent(new URL(url).pathname) } catch { return '' }
        })()
        if (AGGREGATOR_PATH_RE.test(path)) { score += 0.5; reasons.push('path') }
        if (AGGREGATOR_ANCHOR_RE.test(text)) { score += 0.2; reasons.push('anchor') }
    }

    if (score < AGGREGATOR_THRESHOLD) return null

    return {
        url,
        score: Math.round(score * 100) / 100,
        reason: reasons.join('+'),
        kind: 'aggregator',
    }
}
