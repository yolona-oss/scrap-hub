import type { ResolvedAIAgentConfig } from '../config'
import { log } from '@cmd-hub/common'

export interface ResolvedExtractorConfig {
    enabled: true
    baseUrl: string
    apiKey: string | undefined
    model: string
    temperature: number
    maxToolCallsPerPage: number
    timeoutMs: number
    maxRefetches: number
}

interface ExtractorArgsSlice {
    enabled?: boolean
    model?: string
    baseUrl?: string
    apiKey?: string
    temperature?: number
    maxToolCallsPerPage?: number
    timeoutMs?: number
    maxRefetches?: number
}

export function resolveExtractorConfig(
    parent: ResolvedAIAgentConfig | null,
    args: ExtractorArgsSlice | undefined,
): ResolvedExtractorConfig | null {
    if (!parent) {
        log.debug('extractor.config: parent is null → extractor disabled')
        return null
    }
    if (args === undefined) {
        log.debug('extractor.config: args undefined → extractor disabled')
        return null
    }
    if (args.enabled === false) {
        log.debug('extractor.config: enabled=false → extractor disabled')
        return null
    }

    const resolved: ResolvedExtractorConfig = {
        enabled: true,
        baseUrl: args.baseUrl || parent.baseUrl,
        apiKey: args.apiKey || parent.apiKey,
        model: args.model || parent.model,
        temperature: args.temperature ?? 0.1,
        maxToolCallsPerPage: args.maxToolCallsPerPage ?? 8,
        timeoutMs: args.timeoutMs ?? 45000,
        maxRefetches: args.maxRefetches ?? 3,
    }
    log.debug(`extractor.config: resolved model=${resolved.model} (parent=${parent.model}) baseUrl=${resolved.baseUrl} maxToolCallsPerPage=${resolved.maxToolCallsPerPage} maxRefetches=${resolved.maxRefetches}`)
    return resolved
}
