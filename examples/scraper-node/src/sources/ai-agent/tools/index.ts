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
import { log } from "@cmd-hub/common"

export type { ReportState } from "./emit"
export type AgentPhase = 'recon' | 'plan' | 'execute'

export async function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    phase: AgentPhase,
): Promise<Tool[]> {
    log.trace(`ai-agent.tools.buildTools: phase=${phase}`)
    if (phase === 'plan') {
        log.debug('ai-agent.tools.buildTools: plan phase → no tools exposed')
        return []
    }
    if (phase === 'recon') {
        const tools = [makeWebSearchTool(query), makeEndReconTool()]
        log.debug(`ai-agent.tools.buildTools: recon phase → ${tools.map(t => t.name).join(', ')}`)
        return tools
    }
    const tools = [
        makeWebSearchTool(query),
        makeFetchUrlTool(),
        makeParseHtmlTool(),
        makeExtractContactsTool(),
        await makeDelegateSourceTool(query, queue, state),
        makeReportResultsTool(queue, query, state),
        makeRevisePlanTool(),
    ]
    log.debug(`ai-agent.tools.buildTools: execute phase → ${tools.map(t => t.name).join(', ')}`)
    return tools
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
