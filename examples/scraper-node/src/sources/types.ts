import { OrgData, OrgSourceKind, SearchQuery } from "../types"
import type { ServiceContext } from "../exporters/types"

export type SourceAvailability =
    | { ok: true }
    | { ok: false; reason: string }

export interface IScraperSource {
    /** Whether the source is configured well enough to run. Cheap check
     *  (config lookup, optional HEAD probe). The orchestrator and the
     *  ai-agent delegate tool both consult this before invoking `search`.
     *
     *  CONTRACT: must be context-free — same node, same source ⇒ same
     *  result regardless of `context.config`. The registry caches the
     *  result by source name only for 60s; consuming `context` here would
     *  silently misroute one user's "ok" to another user's request. If
     *  per-user availability is needed, do that check inside `search()`
     *  (which is keyed per-invocation, not cached). */
    availability(context?: ServiceContext): Promise<SourceAvailability>

    search(
        query: SearchQuery,
        onProgress: (found: number) => void,
        context?: ServiceContext,
        signal?: AbortSignal,
    ): AsyncGenerator<OrgData>
}

export type ScraperSourceFactory = () => IScraperSource

/** Legacy singular-shape record produced by older source adapters. */
export interface LegacyOrgRecord {
    name: string
    phone: string | null
    email: string | null
    address: string | null
    url?: string
    source: string
}

export interface WrapAsOrgDataOptions {
    /** Override the inferred source kind (default: 'aggregator-detail'). */
    kind?: OrgSourceKind
}

/** Translate a legacy singular-shape org record into v2 OrgData. Used by source adapters
 *  during the transition. PR5 deletes all legacy adapters; this helper goes with them. */
export function wrapAsOrgData(legacy: LegacyOrgRecord, opts: WrapAsOrgDataOptions = {}): OrgData {
    const phones = legacy.phone ? [legacy.phone] : []
    const emails = legacy.email ? [legacy.email] : []
    const addresses = legacy.address ? [legacy.address] : []
    const url = legacy.url
    const kind = opts.kind ?? 'aggregator-detail'
    const sources = url
        ? [{
            url,
            kind,
            extractedAt: new Date().toISOString(),
            extractionMethod: 'deterministic' as const,
        }]
        : []
    return {
        name: legacy.name,
        phones,
        emails,
        addresses,
        sources,
        status: 'partial',
        confidence: 1.0,  // Legacy adapters have hand-coded selectors; trust their output.
        extractionMethod: 'deterministic',
    }
}
