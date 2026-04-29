import { OpenAI } from 'openai'
import { log } from '@cmd-hub/common'
import type { ResolvedExtractorConfig } from './config'
import type { ExtractorInput, ExtractionResult, ExtractorTool, ExtractorReport } from './types'
import { buildExtractorSystemPrompt, buildExtractorUserPrompt } from './prompts'
import { makeReadBlocksTool } from './tools/read-blocks'
import { makeReadJsonBlobTool } from './tools/read-json-blob'
import { makeReportExtractionTool } from './tools/report-extraction'
import { makeReportIncompleteTool } from './tools/report-incomplete'

interface RunOptions {
    client?: OpenAI
}

function buildToolset(): ExtractorTool[] {
    return [
        makeReadBlocksTool(),
        makeReadJsonBlobTool(),
        makeReportExtractionTool(),
        makeReportIncompleteTool(),
    ]
}

function toOpenAISchema(t: ExtractorTool) {
    return {
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
    }
}

function defaultClient(cfg: ResolvedExtractorConfig): OpenAI {
    return new OpenAI({ baseURL: cfg.baseUrl, apiKey: cfg.apiKey ?? 'local-no-key' })
}

export async function runExtractor(
    input: ExtractorInput,
    cfg: ResolvedExtractorConfig,
    signal?: AbortSignal,
    opts: RunOptions = {},
): Promise<ExtractionResult> {
    if (signal?.aborted) {
        log.debug('extractor.loop: aborted before start')
        return { outcome: 'incomplete', reason: 'aborted before start', toolCallsUsed: 0 }
    }

    const client = opts.client ?? defaultClient(cfg)
    const tools = buildToolset()
    const toolByName = new Map(tools.map(t => [t.name, t]))
    const ctx = { input }

    const messages: any[] = [
        { role: 'system', content: buildExtractorSystemPrompt() },
        { role: 'user', content: buildExtractorUserPrompt(input) },
    ]

    const startedAt = Date.now()
    let toolCallsUsed = 0

    while (true) {
        if (signal?.aborted) {
            return { outcome: 'incomplete', reason: 'aborted mid-loop', toolCallsUsed }
        }
        if (Date.now() - startedAt > cfg.timeoutMs) {
            return { outcome: 'incomplete', reason: `timeout (${cfg.timeoutMs}ms)`, toolCallsUsed }
        }
        if (toolCallsUsed >= cfg.maxToolCallsPerPage) {
            return { outcome: 'incomplete', reason: `tool budget exhausted (${cfg.maxToolCallsPerPage})`, toolCallsUsed }
        }

        let resp: any
        try {
            resp = await client.chat.completions.create({
                model: cfg.model,
                temperature: cfg.temperature,
                messages,
                tools: tools.map(toOpenAISchema),
                tool_choice: 'auto',
            })
        } catch (e: any) {
            log.warn(`extractor.loop: chat error: ${e?.message ?? e}`)
            return { outcome: 'incomplete', reason: `chat error: ${e?.message ?? e}`, toolCallsUsed }
        }

        const choice = resp.choices?.[0]
        const msg = choice?.message
        if (!msg) {
            return { outcome: 'incomplete', reason: 'no message in response', toolCallsUsed }
        }
        messages.push(msg)

        const calls = msg.tool_calls ?? []
        if (!calls.length) {
            return { outcome: 'incomplete', reason: 'no tool call in response', toolCallsUsed }
        }

        for (const call of calls) {
            if (call.type !== 'function') continue
            toolCallsUsed += 1
            const tool = toolByName.get(call.function.name)
            if (!tool) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: `unknown tool: ${call.function.name}` }),
                })
                continue
            }
            let parsed: unknown
            try {
                parsed = JSON.parse(call.function.arguments || '{}')
            } catch {
                parsed = {}
            }
            const result = await tool.handler(parsed, ctx)
            if (tool.terminal) {
                const report = result as ExtractorReport
                log.debug(`extractor.loop: terminated via ${tool.name} after ${toolCallsUsed} calls`)
                return { ...report, toolCallsUsed } as ExtractionResult
            }
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
            })
            if (toolCallsUsed >= cfg.maxToolCallsPerPage) {
                return { outcome: 'incomplete', reason: `tool budget exhausted (${cfg.maxToolCallsPerPage})`, toolCallsUsed }
            }
        }
    }
}
