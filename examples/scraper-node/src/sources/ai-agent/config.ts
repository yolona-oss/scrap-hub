import type { ServiceContext } from '../../exporters/types'
import type { ScraperConfig, AIAgentConfig } from '../../scraper-service/config-tree'

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
 * Project the per-user `aiAgent` slice off `context.config` into the
 * shape the AI-agent runtime consumes. Returns `null` when the user
 * explicitly wiped `baseUrl` or `model` to empty strings — that's the
 * per-user "disable AI agent" signal.
 *
 * The framework already merged tree defaults under the user's choices
 * via `unflattenValue`, so there's no fallback merge here — every leaf
 * with a `default:` arrives populated, and the `??` fallbacks below
 * only catch the case where `context.config` was synthesized without
 * going through the parser (e.g. legacy callers).
 */
export function resolveAIAgentConfig(context?: ServiceContext): ResolvedAIAgentConfig | null {
    const ai = ((context?.config ?? {}) as Partial<ScraperConfig>).aiAgent as AIAgentConfig | undefined
    if (!ai?.baseUrl || !ai?.model) return null

    return {
        baseUrl: ai.baseUrl,
        apiKey: ai.apiKey || undefined,
        model: ai.model,
        temperature: ai.temperature ?? 0.2,
        maxToolCalls: ai.maxToolCalls ?? 25,
        toolTimeoutMs: ai.toolTimeoutMs ?? 60_000,
        totalTimeoutMs: ai.totalTimeoutMs ?? 3_600_000,
    }
}
