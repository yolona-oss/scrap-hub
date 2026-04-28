import { getScraperConfig, resolveScraperUserConfig } from "../../scraper-config"
import type { ServiceContext } from "../../exporters/types"

export interface ResolvedAIAgentConfig {
    baseUrl: string
    apiKey: string | undefined
    model: string
    temperature: number
    maxToolCalls: number
    toolTimeoutMs: number
    totalTimeoutMs: number
}

/**
 * Returns resolved AI-agent config. Defaults from `scraper-defaults.ts`
 * apply when the user hasn't set anything; `null` only when the user
 * explicitly wiped baseUrl or model to empty strings (per-user disable).
 */
export async function resolveAIAgentConfig(context?: ServiceContext): Promise<ResolvedAIAgentConfig | null> {
    const sys = await getScraperConfig()
    const userMerged = await resolveScraperUserConfig(context, sys)
    const ai = userMerged.aiAgent

    if (!ai.baseUrl || !ai.model) return null

    return {
        baseUrl: ai.baseUrl,
        apiKey: ai.apiKey || undefined,
        model: ai.model,
        temperature: ai.temperature,
        maxToolCalls: ai.maxToolCalls,
        toolTimeoutMs: ai.toolTimeoutMs,
        totalTimeoutMs: ai.totalTimeoutMs,
    }
}
