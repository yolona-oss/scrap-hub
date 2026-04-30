import { WorkQueue, type WorkQueueContext, type ExtractContactsResult } from '../work-queue'
import type { ClassifiedPage } from '../page-types'
import type { AgentLoopDeps } from '../loop'

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
    return { workQueue, workQueueContext }
}
