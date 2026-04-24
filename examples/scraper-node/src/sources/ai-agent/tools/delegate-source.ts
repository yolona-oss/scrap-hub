import { Tool } from "./types"
import { SourceRegistry } from "../../registry"
import { OrgData, SearchQuery } from "../../../types"
import log from "@logger"

interface DelegateResult {
    orgs: OrgData[]
    error?: string
}

export function makeDelegateSourceTool(baseQuery: SearchQuery): Tool {
    const available = SourceRegistry.available().filter(n => n !== 'ai-agent')
    return {
        name: 'search_source',
        description: `Delegate to a registered scraper source. Available sources: ${available.join(', ')}. Returns a list of organizations already parsed by that source.`,
        parameters: {
            type: 'object',
            properties: {
                source: { type: 'string', description: 'Source name from the available list' },
                query: { type: 'string' },
                limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
            },
            required: ['source', 'query'],
        },
        async handler(args): Promise<DelegateResult> {
            const sourceName = String(args?.source ?? '').trim()
            const queryStr = String(args?.query ?? '').trim()
            const limit = Math.min(Math.max(parseInt(args?.limit ?? 20), 1), 50)

            if (sourceName === 'ai-agent') return { orgs: [], error: 'cannot recurse into ai-agent' }
            if (!SourceRegistry.has(sourceName)) return { orgs: [], error: `unknown source "${sourceName}"` }
            if (!queryStr) return { orgs: [], error: 'empty query' }

            const subQuery: SearchQuery = {
                query: queryStr,
                city: baseQuery.city,
                sources: [sourceName],
                maxResults: limit,
            }

            try {
                const source = SourceRegistry.create(sourceName)
                const orgs: OrgData[] = []
                const gen = source.search(subQuery, () => { /* no-op progress */ })
                for await (const org of gen) {
                    orgs.push(org)
                    if (orgs.length >= limit) break
                }
                return { orgs }
            } catch (e: any) {
                log.error(`ai-agent.search_source[${sourceName}]: ${e.message ?? e}`)
                return { orgs: [], error: String(e.message ?? e) }
            }
        },
    }
}
