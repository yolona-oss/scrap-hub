import { getScraperConfig, IAIAgentConfig, IScraperConfig } from "../../scraper-config"
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

function pickProvider(system: IScraperConfig, chosen?: string): 'serpapi' | 'yandex' | 'duckduckgo' {
    if (chosen === 'serpapi' || chosen === 'yandex' || chosen === 'duckduckgo') return chosen
    if (system.serpApiKey) return 'serpapi'
    if (system.yandexXmlUser && system.yandexXmlKey) return 'yandex'
    return 'duckduckgo'
}

/**
 * Returns resolved config if baseUrl and model are present, else null.
 * Caller logs a warning and short-circuits when null.
 */
export async function resolveAIAgentConfig(context?: ServiceContext): Promise<ResolvedAIAgentConfig | null> {
    const system = await getScraperConfig()
    const sys: IAIAgentConfig = system.aiAgent ?? {}
    const user: IAIAgentConfig = ((context?.config as any)?.aiAgent) ?? {}

    const baseUrl = user.baseUrl ?? sys.baseUrl
    const model = user.model ?? sys.model
    if (!baseUrl || !model) return null

    return {
        baseUrl,
        apiKey: user.apiKey ?? sys.apiKey,
        model,
        temperature: user.temperature ?? sys.temperature ?? 0.2,
        webSearchProvider: pickProvider(system, user.webSearchProvider ?? sys.webSearchProvider),
        maxToolCalls: user.maxToolCalls ?? sys.maxToolCalls ?? 25,
        toolTimeoutMs: user.toolTimeoutMs ?? sys.toolTimeoutMs ?? 60_000,
        totalTimeoutMs: user.totalTimeoutMs ?? sys.totalTimeoutMs ?? 300_000,
    }
}
