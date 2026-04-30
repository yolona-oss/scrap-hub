import { IScraperSource, SourceAvailability } from "../types"
import { OrgData, SearchQuery } from "../../types"
import type { ServiceContext } from "../../exporters/types"
import { resolveAIAgentConfig } from "./config"
import { createClient } from "./client"
import { AsyncQueue } from "./async-queue"
import { ReportState } from "./tools"
import { makeExtractContactsTool, type ExtractorRunner } from "./tools/extract-contacts"
import { classifyPage } from "./classify-page"
import { WorkQueue, type WorkQueueContext, type ExtractContactsResult } from "./work-queue"
import { runExtractor } from "./extractor"
import { runAgentLoop, AgentToolCallInfo } from "./loop"
import { log } from "@cmd-hub/common"

export class AIAgentSource implements IScraperSource {
    /** Context-free per the IScraperSource contract — the registry caches
     *  this result by source name across users. The real "did the user
     *  configure baseUrl/model?" check happens inside `search()` below
     *  (per-invocation, not cached, so it sees the caller's args).
     *
     *  Returning ok=true here means: "the source exists and could run if
     *  configured". Misconfigured runs surface as a thrown error in
     *  `search()`, which the orchestrator reports as `kind:'thrown'`. */
    async availability(_context?: ServiceContext): Promise<SourceAvailability> {
        return { ok: true }
    }

    async* search(
        query: SearchQuery,
        onProgress: (found: number) => void,
        context?: ServiceContext,
        signal?: AbortSignal,
    ): AsyncGenerator<OrgData> {
        const cfg = resolveAIAgentConfig(context)
        if (!cfg) throw new Error('aiAgent.baseUrl / model is empty (set via the /scraper builder under --config --aiAgent --baseUrl / --model)')

        log.info(`ai-agent.search: query="${query.query}" city="${query.city ?? ''}" maxResults=${query.maxResults}`)
        log.debug(`ai-agent.search: model=${cfg.model} baseUrl=${cfg.baseUrl} maxToolCalls=${cfg.maxToolCalls} totalTimeoutMs=${cfg.totalTimeoutMs}`)

        const client = createClient(cfg)
        const queue = new AsyncQueue<OrgData>()
        const reportState: ReportState = { yielded: 0 }

        // The agent loop blocks on AsyncQueue.next(); when the outer scrape
        // cancels, close the queue so the consumer loop below also exits.
        const onAbort = () => queue.close()
        signal?.addEventListener('abort', onAbort, { once: true })

        const liveLog = context?.events?.liveLog
        const onToolCall = liveLog
            ? (info: AgentToolCallInfo) => liveLog([
                `🤖 ${info.name} (${info.durationMs}ms)${info.ok ? '' : ` — ${info.error ?? 'error'}`}: ${info.args.slice(0, 60)}`,
            ])
            : undefined

        // Build the WorkQueueContext: shared classify + extract entry points
        // used by harvest_serp and deepen_org. extract_contacts here is a
        // thin reuse of the same tool the LLM used to call directly; the
        // result shape matches WorkQueueContext.extractContacts via the
        // first four fields of the tool's return.
        const workQueue = new WorkQueue()
        const extractorRunner: ExtractorRunner | undefined = cfg.extractor
            ? (input, sig) => runExtractor(input, cfg.extractor!, sig)
            : undefined
        const extractTool = makeExtractContactsTool({ extractorRunner })
        const workQueueContext: WorkQueueContext = {
            classifyPage: (url, opts) => classifyPage(url, { signal: opts?.signal }),
            extractContacts: async (html, opts): Promise<ExtractContactsResult> => {
                const r: any = await extractTool.handler({ html }, opts?.signal)
                return {
                    phones: Array.isArray(r?.phones) ? r.phones : [],
                    emails: Array.isArray(r?.emails) ? r.emails : [],
                    addresses: Array.isArray(r?.addresses) ? r.addresses : [],
                    candidateName: typeof r?.candidateName === 'string' ? r.candidateName : '',
                }
            },
        }

        const loopPromise = runAgentLoop(
            client, query, queue, reportState, cfg,
            { workQueue, workQueueContext },
            { onToolCall, signal },
        )
            .catch(e => log.error(`ai-agent.search: loop error: ${e?.message ?? e}`))
            .finally(() => {
                queue.close()
                signal?.removeEventListener('abort', onAbort)
            })

        let found = 0
        for await (const org of queue) {
            found++
            log.trace(`ai-agent.search: yield #${found} ${org.name}`)
            onProgress(found)
            yield org
            if (found >= query.maxResults) break
        }

        await loopPromise
        log.info(`ai-agent.search: done found=${found} reported=${reportState.yielded}`)
    }
}
