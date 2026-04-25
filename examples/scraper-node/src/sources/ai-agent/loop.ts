import { OpenAI } from "openai"
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions"
import { Tool, toOpenAISchema } from "./tools"
import { ResolvedAIAgentConfig } from "./config"
import { buildSystemPrompt, buildUserPrompt } from "./prompts"
import { SearchQuery } from "../../types"
import { log } from "@cmd-hub/common"

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
    let turn = 0
    const startTime = Date.now()
    log.debug(`ai-agent.loop: starting model=${cfg.model} maxToolCalls=${cfg.maxToolCalls}`)

    while (true) {
        if (Date.now() - startTime > cfg.totalTimeoutMs) {
            log.warn(`ai-agent.loop: total timeout (${cfg.totalTimeoutMs}ms) exceeded after ${turn} turns, ${toolCallsUsed} tool calls`)
            return
        }

        turn++
        log.trace(`ai-agent.loop: turn ${turn} request (messages=${messages.length})`)
        let response
        const reqStart = Date.now()
        try {
            response = await client.chat.completions.create({
                model: cfg.model,
                temperature: cfg.temperature,
                messages,
                tools: openAITools,
                tool_choice: 'auto',
            })
        } catch (e: any) {
            log.error(`ai-agent.loop: LLM request failed (turn ${turn}): ${e.message ?? e}`)
            return
        }
        log.trace(`ai-agent.loop: turn ${turn} response in ${Date.now() - reqStart}ms`)

        const choice = response.choices?.[0]
        if (!choice) {
            log.warn('ai-agent.loop: LLM returned no choices')
            return
        }

        const assistantMsg = choice.message
        messages.push(assistantMsg as ChatCompletionMessageParam)

        const toolCalls = assistantMsg.tool_calls ?? []
        if (toolCalls.length === 0) {
            log.info(`ai-agent.loop: agent finished after ${turn} turns, ${toolCallsUsed} tool calls`)
            return
        }

        log.debug(`ai-agent.loop: turn ${turn} agent requested ${toolCalls.length} tool call(s)`)

        for (const call of toolCalls) {
            if (call.type !== 'function') {
                log.debug(`ai-agent.loop: skipping non-function tool call type=${call.type}`)
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: 'unsupported tool call type' }),
                })
                continue
            }

            if (toolCallsUsed >= cfg.maxToolCalls) {
                log.warn(`ai-agent.loop: max tool calls (${cfg.maxToolCalls}) reached, asking agent to wrap up`)
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
                log.warn(`ai-agent.loop: agent called unknown tool "${call.function.name}"`)
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
                log.warn(`ai-agent.loop: invalid JSON in tool call "${call.function.name}": ${e.message ?? e}`)
                messages.push({
                    role: 'tool',
                    tool_call_id: call.id,
                    content: JSON.stringify({ error: `invalid arguments: ${e.message ?? e}` }),
                })
                continue
            }

            log.debug(`ai-agent.loop: invoke ${tool.name} args=${JSON.stringify(parsed).slice(0, 200)}`)
            const callStart = Date.now()
            const result = await executeWithTimeout(tool, parsed, cfg.toolTimeoutMs)
            log.trace(`ai-agent.loop: ${tool.name} returned in ${Date.now() - callStart}ms`)
            if (result?.error) {
                log.warn(`ai-agent.loop: ${tool.name} returned error: ${result.error}`)
            }
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
        timer = setTimeout(() => {
            log.warn(`ai-agent.loop: tool "${tool.name}" timeout after ${timeoutMs}ms`)
            resolve({ error: `tool "${tool.name}" timeout after ${timeoutMs}ms` })
        }, timeoutMs)
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
