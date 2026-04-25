import { Tool } from "./types"
import { OrgData, SearchQuery } from "../../../types"
import { AsyncQueue } from "../async-queue"
import { emitMany, ReportState } from "./emit"
import { log } from "@cmd-hub/common"

export function makeReportResultsTool(
    queue: AsyncQueue<OrgData>,
    query: SearchQuery,
    state: ReportState,
): Tool {
    return {
        name: 'report_results',
        description: 'Emit found organizations immediately. Call this for orgs you discovered via web_search/fetch_url. Returns totalYielded so you know when to stop. Note: results from search_source are emitted automatically — no need to re-report them.',
        parameters: {
            type: 'object',
            properties: {
                orgs: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            name: { type: 'string' },
                            source: { type: 'string' },
                            phone: { type: ['string', 'null'] },
                            email: { type: ['string', 'null'] },
                            address: { type: ['string', 'null'] },
                            url: { type: 'string' },
                        },
                        required: ['name', 'source'],
                    },
                },
            },
            required: ['orgs'],
        },
        async handler(args) {
            const orgs = Array.isArray(args?.orgs) ? args.orgs : []
            log.trace(`ai-agent.report_results: ${orgs.length} candidate(s)`)
            const outcome = emitMany(orgs, queue, state, query, 'ai-agent')
            log.debug(`ai-agent.report_results: accepted=${outcome.accepted} rejected=${outcome.rejected} totalYielded=${outcome.totalYielded}`)
            return outcome
        },
    }
}
