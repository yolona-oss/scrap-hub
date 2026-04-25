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

/**
 * Validate a single candidate and, if valid, push it to the agent's output
 * queue. Returns whether the org was accepted; updates `state.yielded`.
 *
 * "Valid" means: a non-empty name and at least one contact channel
 * (phone/email/address). Anything else is rejected silently — the agent
 * shouldn't retry rejects, just learn from the summary.
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
