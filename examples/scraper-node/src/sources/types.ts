import { OrgData, SearchQuery } from "../types"
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
    ): AsyncGenerator<OrgData>
}

export type ScraperSourceFactory = () => IScraperSource
