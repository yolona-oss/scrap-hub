import { Tool } from "./types"
import { makeWebSearchTool } from "./web-search"
import { makeFetchUrlTool } from "./fetch-url"
import { makeParseHtmlTool } from "./parse-html"
import { makeDelegateSourceTool } from "./delegate-source"
import { makeReportResultsTool } from "./report-results"
import { makeExtractContactsTool } from "./extract-contacts"
import { makeEndReconTool } from "./end-recon"
import { makeRevisePlanTool } from "./revise-plan"
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import type { ReportState } from "./emit"

export type { ReportState } from "./emit"
export type AgentPhase = 'recon' | 'plan' | 'execute'

export async function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    phase: AgentPhase,
): Promise<Tool[]> {
    if (phase === 'plan') return []
    if (phase === 'recon') {
        return [makeWebSearchTool(query), makeEndReconTool()]
    }
    return [
        makeWebSearchTool(query),
        makeFetchUrlTool(),
        makeParseHtmlTool(),
        makeExtractContactsTool(),
        await makeDelegateSourceTool(query, queue, state),
        makeReportResultsTool(queue, query, state),
        makeRevisePlanTool(),
    ]
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
