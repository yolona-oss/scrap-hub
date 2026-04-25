import { OrgData, SearchQuery } from "../types"
import type { ServiceContext } from "../exporters/types"

export type SourceAvailability =
    | { ok: true }
    | { ok: false; reason: string }

export interface IScraperSource {
    /** Whether the source is configured well enough to run. Cheap check
     *  (config lookup, no network). The orchestrator and the ai-agent
     *  delegate tool both consult this before invoking `search`. */
    availability(context?: ServiceContext): Promise<SourceAvailability>

    search(
        query: SearchQuery,
        onProgress: (found: number) => void,
        context?: ServiceContext,
    ): AsyncGenerator<OrgData>
}

export type ScraperSourceFactory = () => IScraperSource
