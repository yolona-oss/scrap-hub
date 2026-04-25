import { Tool } from "./types"
import { SourceRegistry } from "../../registry"
import { OrgData, SearchQuery } from "../../../types"
import { AsyncQueue } from "../async-queue"
import { emitOrg, ReportState } from "./emit"
import { log } from "@cmd-hub/common"

interface DelegateResult {
    accepted: number
    rejected: number
    totalYielded: number
    error?: string
}

export async function makeDelegateSourceTool(
    baseQuery: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
): Promise<Tool> {
    const usable = (await SourceRegistry.availableFor()).filter(n => n !== 'ai-agent')
    log.debug(`ai-agent.search_source: usable sources=[${usable.join(', ')}]`)
    return {
        name: 'search_source',
        description: usable.length > 0
            ? `Delegate to a configured scraper source. Available sources: ${usable.join(', ')}. Found organizations are emitted to the user automatically; the response is just a summary (accepted/rejected/totalYielded) so you can decide whether to keep searching.`
            : `No scraper sources are configured. Calling this tool will return an error.`,
        parameters: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'Source name from the available list', enum: usable },
                query: { type: 'string' },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
            required: ['source', 'query'],
        },
        async handler(args): Promise<DelegateResult> {
            const sourceName = String(args?.source ?? '').trim()
            const queryStr = String(args?.query ?? '').trim()
            const limit = Math.min(Math.max(parseInt(args?.limit ?? 20), 1), 50)

            log.trace(`ai-agent.search_source: source="${sourceName}" query="${queryStr}" limit=${limit}`)
            if (sourceName === 'ai-agent') {
                return { accepted: 0, rejected: 0, totalYielded: state.yielded, error: 'cannot recurse into ai-agent' }
            }
            if (!queryStr) {
                return { accepted: 0, rejected: 0, totalYielded: state.yielded, error: 'empty query' }
            }

            const availability = await SourceRegistry.availabilityOf(sourceName)
            if (!availability.ok) {
                log.warn(`ai-agent.search_source[${sourceName}]: unavailable — ${availability.reason}`)
                return { accepted: 0, rejected: 0, totalYielded: state.yielded, error: availability.reason }
            }

            const subQuery: SearchQuery = {
                query: queryStr,
                city: baseQuery.city,
                sources: [sourceName],
                maxResults: limit,
            }

            let accepted = 0
            let rejected = 0
            try {
                const source = SourceRegistry.create(sourceName)
                const gen = source.search(subQuery, () => { /* no-op progress */ })
                for await (const org of gen) {
                    if (emitOrg(org, queue, state, baseQuery, sourceName)) accepted++
                    else rejected++
                    if (accepted >= limit || state.yielded >= baseQuery.maxResults) break
                }
                log.debug(`ai-agent.search_source[${sourceName}]: accepted=${accepted} rejected=${rejected} totalYielded=${state.yielded}`)
                return { accepted, rejected, totalYielded: state.yielded }
            } catch (e: any) {
                log.error(`ai-agent.search_source[${sourceName}]: ${e.message ?? e}`)
                return { accepted, rejected, totalYielded: state.yielded, error: String(e.message ?? e) }
            }
        },
    }
}
