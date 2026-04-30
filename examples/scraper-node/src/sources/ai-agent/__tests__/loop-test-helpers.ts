import { WorkQueue, type WorkQueueContext, type ExtractContactsResult, type LLMJudgeContext } from '../work-queue'
import type { ClassifiedPage } from '../page-types'
import type { AgentLoopDeps } from '../loop'
import type { FillGapContext } from '../tools/fill-gap'

/** Stub WorkQueueContext: classifyPage returns 'other' (no extraction triggered),
 *  extractContacts returns empty. Override per-test by passing replacements. */
export function makeStubDeps(overrides: Partial<WorkQueueContext> = {}): AgentLoopDeps {
    const workQueue = new WorkQueue()
    const workQueueContext: WorkQueueContext = {
        classifyPage: async (url): Promise<ClassifiedPage> => ({
            url, pageType: 'other', confidence: 0, signals: [],
            cleanedText: '', candidateBlocks: [], jsonLdBlobs: [],
            contactCandidates: [], aggregatorCandidates: [], branchCandidates: [],
        }),
        extractContacts: async (): Promise<ExtractContactsResult> => ({
            phones: [], emails: [], addresses: [], candidateName: '',
        }),
        ...overrides,
    }
    const fillGapContext: FillGapContext = {
        webSearch: async () => ({ results: [] }),
        classifyPage: workQueueContext.classifyPage,
        extractContacts: workQueueContext.extractContacts,
    }
    const llmJudgeContext: LLMJudgeContext = {
        callJudge: async () => ({ content: null }),
    }
    return { workQueue, workQueueContext, fillGapContext, llmJudgeContext }
}
