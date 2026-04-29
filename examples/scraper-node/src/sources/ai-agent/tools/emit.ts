import { OrgData, SearchQuery } from "../../../types"
import { AsyncQueue } from "../async-queue"
import { log } from "@cmd-hub/common"

export interface ReportState {
    yielded: number
}

export interface EmitOutcome {
    accepted: number
    rejected: number
    totalYielded: number
}

/** Lowercased stem of `city` for substring comparison against an address.
 *  Russian addresses inflect the city ("в Санкт-Петербурге", "из Москвы")
 *  so we trim the trailing inflection chars and match on the stem. */
function cityStem(city: string): string {
    const lower = city.toLowerCase().trim()
    if (lower.length <= 4) return lower
    return lower.slice(0, -2)
}

// Street markers — at least one of these signals a real address line.
const STREET_MARKER_REGEX = /(?:^|\W)(ул\.?|улица|пр(?:осп)?\.?|проспект|пер\.?|переулок|пл\.?|площадь|наб\.?|набережная|ш\.?|шоссе|БЦ|ТЦ|ЖК|корп\.?|стр\.?|д\.\s*\d|дом\s+\d)(?:\W|$)/iu

// Hard rejects — strings that look like a URL, email, phone, breadcrumb, or
// HTML/markdown junk are never an address.
const URL_REGEX = /https?:\/\/|www\.[a-z0-9-]+\./i
const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w-]+/
const PHONE_REGEX = /(?:\+7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/
const BREADCRUMB_REGEX = /\s>\s|\s→\s|\s—\s.*—\s/  // " > ", " → ", or em-dash chain
const HTML_TAG_REGEX = /<[a-z][^>]*>/i

/**
 * Validate and normalize an address string.
 * - Returns the canonical address string if valid (with city deduced if missing).
 * - Returns null if the value isn't a real address (URL, email, phone, breadcrumb, etc.)
 *   or if it's in a different city than `queryCity`.
 *
 * Examples (queryCity="Санкт-Петербург"):
 *   "г. Санкт-Петербург, ул. Пушкина, 12"  → unchanged
 *   "Невский пр., 28"                       → "г. Санкт-Петербург, Невский пр., 28"
 *   "БЦ Ренессанс, 5 этаж"                  → "г. Санкт-Петербург, БЦ Ренессанс, 5 этаж"
 *   "г. Москва, ул. Тверская, 7"            → null (off-target city)
 *   "https://example.com/contacts"           → null (URL)
 *   "Главная > О компании > Контакты"        → null (breadcrumb)
 *   "+7 (812) 123-45-67"                     → null (phone)
 *   "Санкт-Петербург"                        → "г. Санкт-Петербург" (bare city, on-target)
 */
export function validateAndNormalizeAddress(raw: string, queryCity?: string): string | null {
    const trimmed = raw.trim()
    if (!trimmed || trimmed.length < 4) return null

    // Hard rejects first.
    if (URL_REGEX.test(trimmed)) return null
    if (EMAIL_REGEX.test(trimmed)) return null
    if (PHONE_REGEX.test(trimmed)) return null
    if (BREADCRUMB_REGEX.test(trimmed)) return null
    if (HTML_TAG_REGEX.test(trimmed)) return null

    const lowered = trimmed.toLowerCase()
    const stem = queryCity ? cityStem(queryCity) : ''

    // Off-target-city check: if the address mentions a city *other* than
    // queryCity, reject. We approximate this by looking for any other known
    // capital-letter city pattern when stem is set and absent from the string.
    // The simpler heuristic the existing code uses: if stem is set and the
    // address contains it, OK; if stem set and address mentions a different
    // recognizable city marker (`г. <Word>` not matching stem), reject.
    if (stem) {
        const hasOurCity = lowered.includes(stem)
        const otherCityMatch = trimmed.match(/г\.\s*([А-ЯЁ][а-яё-]+(?:\s+[А-ЯЁ][а-яё-]+)?)/u)
        if (otherCityMatch && !hasOurCity) {
            return null
        }
    }

    const hasStreetMarker = STREET_MARKER_REGEX.test(trimmed)
    const hasOurCity = stem ? lowered.includes(stem) : false
    const hasDigit = /\d/.test(trimmed)

    // Acceptance:
    // - Has a street marker (`ул.`, `БЦ`, `д. 5`, etc.) → accept
    // - Has our city + a digit (looks like "Санкт-Петербург, 12") → accept
    // - Just a bare city matching queryCity → accept (deduce minimal canonical form)
    // - Otherwise reject (likely garbage like a page title or "Главная")
    let canonical: string
    if (hasStreetMarker) {
        // Prefix city if missing.
        canonical = hasOurCity || !queryCity ? trimmed : `г. ${queryCity}, ${trimmed}`
    } else if (hasOurCity && hasDigit) {
        canonical = trimmed
    } else if (queryCity && lowered.trim() === queryCity.toLowerCase().trim()) {
        canonical = `г. ${queryCity}`
    } else if (hasOurCity && !hasDigit) {
        // City mentioned but no street, no digit — too vague (e.g. "по Санкт-Петербургу").
        return null
    } else {
        return null
    }

    return canonical
}

/**
 * Validate a single candidate and, if valid, push it to the agent's output
 * queue. Returns whether the org was accepted; updates `state.yielded`.
 *
 * "Valid" means: a non-empty name AND at least one contact channel
 * (phone/email/address). Bad addresses (URL, email, phone, breadcrumb, off-target
 * city, etc.) are dropped from the address field but the org is still accepted
 * if phone or email survive.
 */
export function emitOrg(
    raw: any,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    query: SearchQuery,
    fallbackSource: string,
): boolean {
    if (state.yielded >= query.maxResults) {
        log.trace(`emit.emitOrg: skipped — maxResults (${query.maxResults}) reached`)
        return false
    }
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    const phone = raw?.phone ? String(raw.phone) : null
    const email = raw?.email ? String(raw.email) : null
    const rawAddress = raw?.address ? String(raw.address) : null
    const source = typeof raw?.source === 'string' && raw.source.trim() ? raw.source.trim() : fallbackSource
    const url = typeof raw?.url === 'string' ? raw.url : undefined

    if (!name) {
        log.trace(`emit.emitOrg: rejected — empty name`)
        return false
    }

    // Validate + normalize address. Bad addresses become null — the org may
    // still pass if phone or email is present.
    const address = rawAddress ? validateAndNormalizeAddress(rawAddress, query.city) : null
    if (rawAddress && !address) {
        log.trace(`emit.emitOrg: address rejected as not-an-address or off-city (rawLen=${rawAddress.length})`)
    }

    if (!phone && !email && !address) {
        log.debug(`emit.emitOrg: rejected — no contact channel survived (name="${name.slice(0, 60)}" hadRawAddress=${Boolean(rawAddress)})`)
        return false
    }

    log.trace(`emit.emitOrg: accepted source=${source} hasPhone=${Boolean(phone)} hasEmail=${Boolean(email)} hasAddress=${Boolean(address)} yielded=${state.yielded + 1}/${query.maxResults}`)
    queue.push({ name, source, phone, email, address, url })
    state.yielded++
    return true
}

export function emitMany(
    orgs: any[],
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    query: SearchQuery,
    fallbackSource: string,
): EmitOutcome {
    log.debug(`emit.emitMany: source=${fallbackSource} batch=${orgs.length}`)
    let accepted = 0
    let rejected = 0
    for (const raw of orgs) {
        if (emitOrg(raw, queue, state, query, fallbackSource)) accepted++
        else rejected++
        if (state.yielded >= query.maxResults) break
    }
    log.debug(`emit.emitMany: source=${fallbackSource} done accepted=${accepted} rejected=${rejected} totalYielded=${state.yielded}`)
    return { accepted, rejected, totalYielded: state.yielded }
}
