import { Tool } from "./types"
import { makeWebSearchTool } from "./web-search"
import { type ExtractorRunner } from "./extract-contacts"
import { makeEndReconTool } from "./end-recon"
import { makeRevisePlanTool } from "./revise-plan"
import { makeListOrgsTool } from "./list-orgs"
import { makePickNextPartialTool } from "./pick-next-partial"
import { makeFreezeOrgTool } from "./freeze-org"
import { makeDiscoverOrgCandidatesTool } from "./discover-org-candidates"
import { makeHarvestSerpTool } from "./harvest-serp"
import { makeDeepenOrgTool } from "./deepen-org"
import { makeFillGapTool } from "./fill-gap"
import type { FillGapContext } from "./fill-gap"
import { makeReviewOrgTool } from "./review-org"
import { SearchQuery, OrgData } from "../../../types"
import { AsyncQueue } from "../async-queue"
import type { WorkQueue, WorkQueueContext, LLMJudgeContext } from "../work-queue"
import { log } from "@cmd-hub/common"

export type { ReportState } from "./emit"
export type { ExtractorRunner } from "./extract-contacts"
export type AgentPhase = 'recon' | 'plan' | 'harvest' | 'deepen+review'

export interface BuildToolsOptions {
    extractorRunner?: ExtractorRunner
    /** Required during harvest + deepen+review phases. The work queue carries
     *  partial → saturated → verified records; phase tools mutate it. */
    workQueue?: WorkQueue
    workQueueContext?: WorkQueueContext
    /** Per-org deepening budget for deepen_org. Required when workQueue is set. */
    maxToolCallsPerOrg?: number
    /** Required during deepen+review: web-search adapter for fill_gap. */
    fillGapContext?: FillGapContext
    /** Required during deepen+review: JSON-output completion seam for review_org. */
    llmJudgeContext?: LLMJudgeContext
}

export async function buildTools(
    query: SearchQuery,
    emitQueue: AsyncQueue<OrgData>,
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

    if (!opts.workQueue || !opts.workQueueContext) {
        throw new Error(`buildTools: phase ${phase} requires workQueue + workQueueContext`)
    }
    const wq = opts.workQueue
    const ctx = opts.workQueueContext

    if (phase === 'harvest') {
        const tools: Tool[] = [
            makeWebSearchTool(query),
            makeHarvestSerpTool(wq, ctx, query),
            makeDiscoverOrgCandidatesTool(ctx),
            makeRevisePlanTool(),
        ]
        log.debug(`ai-agent.tools.buildTools: harvest phase → ${tools.map(t => t.name).join(', ')}`)
        return tools
    }

    // deepen+review
    if (!opts.fillGapContext || !opts.llmJudgeContext) {
        throw new Error('buildTools: deepen+review phase requires fillGapContext + llmJudgeContext')
    }
    const budget = opts.maxToolCallsPerOrg ?? 5
    const tools: Tool[] = [
        makeListOrgsTool(wq),
        makePickNextPartialTool(wq),
        makeDeepenOrgTool(wq, ctx, budget, query),
        makeFillGapTool(wq, opts.fillGapContext, query),
        makeReviewOrgTool(wq, opts.llmJudgeContext, emitQueue),
        makeFreezeOrgTool(wq, emitQueue),
        makeRevisePlanTool(),
    ]
    log.debug(`ai-agent.tools.buildTools: deepen+review phase → ${tools.map(t => t.name).join(', ')}`)
    return tools
}

export { toOpenAISchema } from "./types"
export type { Tool } from "./types"
