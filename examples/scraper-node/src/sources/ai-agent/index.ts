import { IScraperSource, SourceAvailability } from "../types"
import { OrgData, SearchQuery } from "../../types"
import type { ServiceContext } from "../../exporters/types"
import { resolveAIAgentConfig } from "./config"
import { createClient } from "./client"
import { AsyncQueue } from "./async-queue"
import { buildTools, ReportState } from "./tools"
import { runAgentLoop, AgentToolCallInfo } from "./loop"
import { log } from "@cmd-hub/common"

export class AIAgentSource implements IScraperSource {
    async availability(context?: ServiceContext): Promise<SourceAvailability> {
        const cfg = await resolveAIAgentConfig(context)
        if (!cfg) return { ok: false, reason: 'aiAgent.baseUrl / model is empty (use /sconfig scraper aiAgent.baseUrl <url> or set via the builder)' }
        return { ok: true }
    }

    async* search(
        query: SearchQuery,
        onProgress: (found: number) => void,
        context?: ServiceContext,
        signal?: AbortSignal,
    ): AsyncGenerator<OrgData> {
        const cfg = await resolveAIAgentConfig(context)
        if (!cfg) throw new Error('aiAgent.baseUrl / model is empty')

        log.info(`ai-agent.search: query="${query.query}" city="${query.city ?? ''}" maxResults=${query.maxResults}`)
        log.debug(`ai-agent.search: model=${cfg.model} baseUrl=${cfg.baseUrl} maxToolCalls=${cfg.maxToolCalls} totalTimeoutMs=${cfg.totalTimeoutMs}`)

        const client = createClient(cfg)
        const queue = new AsyncQueue<OrgData>()
        const reportState: ReportState = { yielded: 0 }
        const tools = await buildTools(query, queue, reportState)
        log.trace(`ai-agent.search: tools=[${tools.map(t => t.name).join(', ')}]`)

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

        const loopPromise = runAgentLoop(client, query, tools, cfg, { onToolCall, signal })
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
