import { OrgData, SearchQuery } from "../../../types"
import { AsyncQueue } from "../async-queue"

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
 *  so we trim the trailing inflection chars and match on the stem. The
 *  trim is conservative — multi-word cities ("Санкт-Петербург", "Нижний
 *  Новгород") keep enough length to stay unambiguous. */
function cityStem(city: string): string {
    const lower = city.toLowerCase().trim()
    // Drop up to 2 trailing chars when long enough to absorb Russian case
    // endings ("-е", "-а", "-у", "-ой", "-ом"). Very short city names (≤4
    // chars: "Уфа", "Сочи") keep their full form — trimming would hit
    // unrelated words. The cutoff 4 lets "Москва"/"Казань" (6) trim to
    // "моск"/"казан", which still matches "Москве"/"Казани" via substring.
    if (lower.length <= 4) return lower
    return lower.slice(0, -2)
}

/**
 * Validate a single candidate and, if valid, push it to the agent's output
 * queue. Returns whether the org was accepted; updates `state.yielded`.
 *
 * "Valid" means: a non-empty name AND at least one contact channel
 * (phone/email/address) AND, when `query.city` is set, no evidence the
 * org is in a different city. Anything else is rejected silently — the
 * agent shouldn't retry rejects, just learn from the summary.
 */
export function emitOrg(
    raw: any,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    query: SearchQuery,
    fallbackSource: string,
): boolean {
    if (state.yielded >= query.maxResults) return false
    const name = typeof raw?.name === 'string' ? raw.name.trim() : ''
    const phone = raw?.phone ? String(raw.phone) : null
    const email = raw?.email ? String(raw.email) : null
    const address = raw?.address ? String(raw.address) : null
    const source = typeof raw?.source === 'string' && raw.source.trim() ? raw.source.trim() : fallbackSource
    const url = typeof raw?.url === 'string' ? raw.url : undefined

    if (!name || (!phone && !email && !address)) return false

    // Off-target-city guard: when an address is present and the user
    // specified a target city, drop orgs whose address doesn't mention the
    // target. Phone/email-only orgs pass through (no signal to filter on).
    // The model frequently writes wrong cities into search_source queries
    // (e.g. "адвокат рязань" while target is Санкт-Петербург); this catches
    // that regardless of how the bad city got in.
    if (query.city && address) {
        const stem = cityStem(query.city)
        if (stem && !address.toLowerCase().includes(stem)) return false
    }

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
    let accepted = 0
    let rejected = 0
    for (const raw of orgs) {
        if (emitOrg(raw, queue, state, query, fallbackSource)) accepted++
        else rejected++
        if (state.yielded >= query.maxResults) break
    }
    return { accepted, rejected, totalYielded: state.yielded }
}
