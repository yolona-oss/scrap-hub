import { IScraperSource } from "../types"
import { OrgData, SearchQuery } from "../../types"
import type { ServiceContext } from "../../exporters/types"
import { resolveAIAgentConfig } from "./config"
import { createClient } from "./client"
import { AsyncQueue } from "./async-queue"
import { buildTools, ReportState } from "./tools"
import { runAgentLoop } from "./loop"
import { log } from "@cmd-hub/common"

export class AIAgentSource implements IScraperSource {
    readonly name = 'AI-search'
    readonly requiresApiKey = false

    async* search(
        query: SearchQuery,
        onProgress: (found: number) => void,
        context?: ServiceContext,
    ): AsyncGenerator<OrgData> {
        const cfg = await resolveAIAgentConfig(context)
        if (!cfg) {
            log.warn('ai-agent: baseUrl or model not configured (system or user), skipping')
            return
        }

        const client = createClient(cfg)
        const queue = new AsyncQueue<OrgData>()
        const reportState: ReportState = { yielded: 0 }
        const tools = buildTools(query, queue, cfg, reportState)

        const loopPromise = runAgentLoop(client, query, tools, cfg)
            .catch(e => log.error(`ai-agent loop error: ${e?.message ?? e}`))
            .finally(() => queue.close())

        let found = 0
        for await (const org of queue) {
            found++
            onProgress(found)
            yield org
            if (found >= query.maxResults) break
        }

        await loopPromise
    }
}
