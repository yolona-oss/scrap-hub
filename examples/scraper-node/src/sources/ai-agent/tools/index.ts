import { Tool } from "./types"
import { makeWebSearchTool } from "./web-search"
import { makeFetchUrlTool } from "./fetch-url"
import { makeParseHtmlTool } from "./parse-html"
import { makeDelegateSourceTool } from "./delegate-source"
import { makeReportResultsTool } from "./report-results"
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import { ResolvedAIAgentConfig } from "../config"
import type { ReportState } from "./emit"

export type { ReportState } from "./emit"

export async function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    cfg: ResolvedAIAgentConfig,
    state: ReportState,
): Promise<Tool[]> {
    return [
        makeWebSearchTool(cfg.webSearchProvider),
        makeFetchUrlTool(),
        makeParseHtmlTool(),
        await makeDelegateSourceTool(query, queue, state),
        makeReportResultsTool(queue, query, state),
    ]
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
