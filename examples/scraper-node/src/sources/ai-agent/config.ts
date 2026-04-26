import { getScraperConfig, resolveScraperUserConfig } from "../../scraper-config"
import type { ServiceContext } from "../../exporters/types"

export interface ResolvedAIAgentConfig {
    baseUrl: string
    apiKey: string | undefined
    model: string
    temperature: number
    webSearchProvider: 'serpapi' | 'yandex' | 'duckduckgo'
    maxToolCalls: number
    toolTimeoutMs: number
    totalTimeoutMs: number
}

/**
 * Returns resolved AI-agent config. Defaults from `scraper-defaults.ts`
 * apply when the user hasn't set anything; `null` only when the user
 * explicitly wiped baseUrl or model to empty strings (per-user disable).
 *
 * Provider auto-selection: if the user/system explicitly set a provider,
 * honor it. Otherwise pick `serpapi` if a key is configured, then
 * `yandex` if XML creds are configured, else fall back to `duckduckgo`.
 */
export async function resolveAIAgentConfig(context?: ServiceContext): Promise<ResolvedAIAgentConfig | null> {
    const sys = await getScraperConfig()
    const userMerged = await resolveScraperUserConfig(context, sys)
    const ai = userMerged.aiAgent

    if (!ai.baseUrl || !ai.model) return null

    // Re-pick provider when the merged value is the system default and
    // sys has credentials for a different (better) provider.
    let provider = ai.webSearchProvider
    const userExplicitProvider = (context?.config as any)?.aiAgent?.webSearchProvider
    if (!userExplicitProvider) {
        if (sys.serpApiKey) provider = 'serpapi'
        else if (sys.yandexXmlUser && sys.yandexXmlKey) provider = 'yandex'
    }

    return {
        baseUrl: ai.baseUrl,
        apiKey: ai.apiKey || undefined,
        model: ai.model,
        temperature: ai.temperature,
        webSearchProvider: provider,
        maxToolCalls: ai.maxToolCalls,
        toolTimeoutMs: ai.toolTimeoutMs,
        totalTimeoutMs: ai.totalTimeoutMs,
    }
}
