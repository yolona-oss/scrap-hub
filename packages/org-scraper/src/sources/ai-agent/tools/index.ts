import { Tool } from "./types"
import { makeWebSearchTool } from "./web-search"
import { makeFetchUrlTool } from "./fetch-url"
import { makeDelegateSourceTool } from "./delegate-source"
import { makeReportResultsTool } from "./report-results"
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import { ResolvedAIAgentConfig } from "../config"

export interface ReportState {
    yielded: number
}

export function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    cfg: ResolvedAIAgentConfig,
    state: ReportState,
): Tool[] {
    return [
        makeWebSearchTool(cfg.webSearchProvider),
        makeFetchUrlTool(),
        makeDelegateSourceTool(query),
        makeReportResultsTool(queue, query, state),
    ]
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
