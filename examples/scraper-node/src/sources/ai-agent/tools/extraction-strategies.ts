import type * as cheerio from 'cheerio'

export interface PartialExtraction {
    phones?: string[]
    emails?: string[]
    addresses?: string[]
    candidateName?: string
}

const PHONE_REGEX = /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/g
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g
const ADDRESS_REGEX = /(?:ул\.|улица|пр\.|проспект|пер\.|переулок|д\.|дом)\s+[А-ЯЁа-яё0-9\s,.-]{3,80}/g

export function normalizePhone(raw: string): string {
    const digits = raw.replace(/\D/g, '')
    if (digits.length === 11 && digits.startsWith('8')) return '+7' + digits.slice(1)
    if (digits.length === 11 && digits.startsWith('7')) return '+' + digits
    if (digits.length === 10) return '+7' + digits
    return raw.trim()
}

function flattenAddress(addr: unknown): string | undefined {
    if (!addr) return undefined
    if (typeof addr === 'string') return addr
    if (typeof addr === 'object') {
        const a = addr as Record<string, unknown>
        const parts = [a.streetAddress, a.addressLocality, a.postalCode]
            .filter(p => typeof p === 'string') as string[]
        if (parts.length) return parts.join(', ')
    }
    return undefined
}

function isLocalBusinessType(t: unknown): boolean {
    if (typeof t === 'string') return /LocalBusiness|Organization|MedicalBusiness|Dentist/i.test(t)
    if (Array.isArray(t)) return t.some(x => typeof x === 'string' && /LocalBusiness|Organization|MedicalBusiness|Dentist/i.test(x))
    return false
}

export function parseJsonLdBlobs($: cheerio.CheerioAPI): unknown[] {
    const blobs: unknown[] = []
    $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text().trim()
        if (!raw) return
        try {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed)) blobs.push(...parsed)
            else blobs.push(parsed)
        } catch {
            // Malformed JSON-LD is common in the wild; ignore broken blocks.
        }
    })
    return blobs
}

export function extractFromJsonLd(blobs: unknown[]): PartialExtraction {
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()
    let candidateName = ''

    for (const blob of blobs) {
        if (!blob || typeof blob !== 'object') continue
        const b = blob as Record<string, unknown>
        if (!isLocalBusinessType(b['@type'])) continue

        if (typeof b.name === 'string' && !candidateName) candidateName = b.name
        if (typeof b.telephone === 'string') phones.add(normalizePhone(b.telephone))
        if (typeof b.email === 'string') emails.add(b.email.toLowerCase())
        const a = flattenAddress(b.address)
        if (a) addresses.add(a)
    }

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
        candidateName: candidateName || undefined,
    }
}

export function extractFromMicrodata($: cheerio.CheerioAPI): PartialExtraction {
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()
    let candidateName = ''

    $('[itemprop="telephone"]').each((_, el) => {
        const t = $(el).text().trim()
        if (t) phones.add(normalizePhone(t))
    })
    $('[itemprop="email"]').each((_, el) => {
        const t = $(el).text().trim()
        if (t) emails.add(t.toLowerCase())
    })
    $('[itemprop="address"], [itemprop="streetAddress"]').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim()
        if (t) addresses.add(t)
    })
    const nm = $('[itemprop="name"]').first().text().trim()
    if (nm) candidateName = nm

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
        candidateName: candidateName || undefined,
    }
}

export function extractFromSemanticHtml($: cheerio.CheerioAPI): PartialExtraction {
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()

    $('a[href^="tel:"]').each((_, el) => {
        const h = ($(el).attr('href') ?? '').replace(/^tel:/i, '').trim()
        if (h) phones.add(normalizePhone(h))
    })
    $('a[href^="mailto:"]').each((_, el) => {
        const h = ($(el).attr('href') ?? '').replace(/^mailto:/i, '').trim().toLowerCase()
        if (h) emails.add(h)
    })
    $('address').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim()
        if (t) addresses.add(t)
    })
    $('.address, .adres, .contacts__address, [class*="address"]').each((_, el) => {
        const t = $(el).text().replace(/\s+/g, ' ').trim()
        if (t) addresses.add(t)
    })

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
    }
}

export function extractFromRegex(text: string): PartialExtraction {
    const phones = new Set<string>()
    const emails = new Set<string>()
    const addresses = new Set<string>()

    for (const m of text.match(PHONE_REGEX) ?? []) phones.add(normalizePhone(m))
    for (const m of text.match(EMAIL_REGEX) ?? []) emails.add(m.toLowerCase())
    for (const m of text.match(ADDRESS_REGEX) ?? []) {
        addresses.add(m.replace(/\s+/g, ' ').trim())
    }

    return {
        phones: Array.from(phones),
        emails: Array.from(emails),
        addresses: Array.from(addresses),
    }
}
