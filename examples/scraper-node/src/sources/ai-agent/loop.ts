import { OpenAI } from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { Tool, toOpenAISchema } from "./tools"
import { ResolvedAIAgentConfig } from "./config"
import { buildSystemPrompt, buildUserPrompt } from "./prompts"
import { SearchQuery } from "../../types"
import log from "@logger"

export async function runAgentLoop(
    client: OpenAI,
    query: SearchQuery,
    tools: Tool[],
    cfg: ResolvedAIAgentConfig,
): Promise<void> {
    const toolByName = new Map(tools.map(t => [t.name, t]))
    const openAITools = tools.map(toOpenAISchema)

    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: buildSystemPrompt(query) },
        { role: 'user', content: buildUserPrompt(query) },
    ]

    let toolCallsUsed = 0
    const startTime = Date.now()

    while (true) {
        if (Date.now() - startTime > cfg.totalTimeoutMs) {
            log.warn(`ai-agent: total timeout (${cfg.totalTimeoutMs}ms) exceeded`)
            return
        }

        let response
        try {
            response = await client.chat.completions.create({
                model: cfg.model,
                temperature: cfg.temperature,
                messages,
                tools: openAITools,
                tool_choice: 'auto',
            })
        } catch (e: any) {
            log.error(`ai-agent: LLM request failed: ${e.message ?? e}`)
            return
        }

        const choice = response.choices?.[0]
        if (!choice) {
            log.warn('ai-agent: LLM returned no choices')
            return
        }

        const assistantMsg = choice.message
        messages.push(assistantMsg as ChatCompletionMessageParam)

        const toolCalls = assistantMsg.tool_calls ?? []
        if (toolCalls.length === 0) {
            // Agent ended with a content message — done.
            return
        }

        for (const call of toolCalls) {
            if (call.type !== 'function') {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: 'unsupported tool call type' }),
                })
                continue
            }

            if (toolCallsUsed >= cfg.maxToolCalls) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: 'max tool calls reached, wrap up with report_results' }),
                })
                continue
            }
            toolCallsUsed++

            const tool = toolByName.get(call.function.name)
            if (!tool) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: `unknown tool "${call.function.name}"` }),
                })
                continue
            }

            let parsed: any
            try {
                parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {}
            } catch (e: any) {
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: `invalid arguments: ${e.message ?? e}` }),
                })
                continue
            }

            const result = await executeWithTimeout(tool, parsed, cfg.toolTimeoutMs)
            messages.push({
                role: 'tool',
                tool_call_id: call.id,
                content: JSON.stringify(result),
            })
        }
    }
}

async function executeWithTimeout(tool: Tool, args: any, timeoutMs: number): Promise<any> {
    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<any>(resolve => {
        timer = setTimeout(() => resolve({ error: `tool "${tool.name}" timeout after ${timeoutMs}ms` }), timeoutMs)
    })
    try {
        const result = await Promise.race([
            tool.handler(args).catch(e => ({ error: String(e?.message ?? e) })),
            timeoutPromise,
        ])
        return result
    } finally {
        if (timer) clearTimeout(timer)
    }
}
