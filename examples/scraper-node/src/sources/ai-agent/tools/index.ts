import { Tool } from "./types"
import { makeWebSearchTool } from "./web-search"
import { makeFetchUrlTool } from "./fetch-url"
import { makeParseHtmlTool } from "./parse-html"
import { makeReportResultsTool } from "./report-results"
import { makeExtractContactsTool, type ExtractorRunner } from "./extract-contacts"
import { makeEndReconTool } from "./end-recon"
import { makeRevisePlanTool } from "./revise-plan"
import { makeListOrgsTool } from "./list-orgs"
import { makePickNextPartialTool } from "./pick-next-partial"
import { makeFreezeOrgTool } from "./freeze-org"
import { makeDiscoverOrgCandidatesTool } from "./discover-org-candidates"
import { makeHarvestSerpTool } from "./harvest-serp"
import { makeDeepenOrgTool } from "./deepen-org"
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import type { ReportState } from "./emit"
import type { WorkQueue, WorkQueueContext } from "../work-queue"
import { log } from "@cmd-hub/common"

export type { ReportState } from "./emit"
export type { ExtractorRunner } from "./extract-contacts"
export type AgentPhase = 'recon' | 'plan' | 'execute'

export interface BuildToolsOptions {
    extractorRunner?: ExtractorRunner
    /** When provided, queue tools (list_orgs, pick_next_partial, freeze_org,
     *  discover_org_candidates, harvest_serp, deepen_org) are added to the toolset.
     *  PR4b adds the option; PR4c wires the loop to provide it during harvest+deepen+review phases. */
    workQueue?: WorkQueue
    workQueueContext?: WorkQueueContext
    /** Per-org deepening budget for deepen_org. Required when workQueue is set. */
    maxToolCallsPerOrg?: number
}

export async function buildTools(
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    phase: AgentPhase,
    opts: BuildToolsOptions = {},
): Promise<Tool[]> {
    log.trace(`ai-agent.tools.buildTools: phase=${phase} extractor=${opts.extractorRunner ? 'on' : 'off'} workQueue=${opts.workQueue ? 'on' : 'off'}`)
    if (phase === 'plan') {
        log.debug('ai-agent.tools.buildTools: plan phase → no tools exposed')
        return []
    }
    if (phase === 'recon') {
        const tools = [makeWebSearchTool(query), makeEndReconTool()]
        log.debug(`ai-agent.tools.buildTools: recon phase → ${tools.map(t => t.name).join(', ')}`)
        return tools
    }
    const tools: Tool[] = [
        makeWebSearchTool(query),
        makeFetchUrlTool(),
        makeParseHtmlTool(),
        makeExtractContactsTool({ extractorRunner: opts.extractorRunner }),
        makeReportResultsTool(queue, query, state),
        makeRevisePlanTool(),
    ]

    if (opts.workQueue && opts.workQueueContext) {
        const wq = opts.workQueue
        const ctx = opts.workQueueContext
        const budget = opts.maxToolCallsPerOrg ?? 5
        tools.push(
            makeListOrgsTool(wq),
            makePickNextPartialTool(wq),
            makeFreezeOrgTool(wq),
            makeDiscoverOrgCandidatesTool(ctx),
            makeHarvestSerpTool(wq, ctx),
            makeDeepenOrgTool(wq, ctx, budget),
        )
    }

    log.debug(`ai-agent.tools.buildTools: execute phase → ${tools.map(t => t.name).join(', ')}`)
    return tools
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
