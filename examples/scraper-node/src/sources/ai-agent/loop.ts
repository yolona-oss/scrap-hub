import { OpenAI } from "openai"
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions"
import { Tool, toOpenAISchema, buildTools, AgentPhase, type ExtractorRunner } from "./tools"
import { ResolvedAIAgentConfig } from "./config"
import { runExtractor } from "./extractor"
import {
    buildRolePrompt,
    buildReconInstructions,
    buildPlanInstructions,
    buildExecuteInstructions,
    buildPlanPin,
    buildUserPrompt,
} from "./prompts"
import { SearchQuery, OrgData } from "../../types"
import { AsyncQueue } from "./async-queue"
import type { ReportState } from "./tools"
import { log } from "@cmd-hub/common"

const RECON_BUDGET = 10
const REVISE_MIN_EXECUTE_TURNS = 2
/** Tools whose calls always run fresh — never replayed from cache.
 *  - report_results: emits to the user queue; replaying would re-emit duplicates.
 *  - end_recon, revise_plan: signaling tools whose effect is the phase transition,
 *    not the returned payload. */
const NON_CACHEABLE_TOOLS = new Set(['report_results', 'end_recon', 'revise_plan'])

interface ProgressFields {
    yielded: number
    target: number
    toolsUsed: number
    toolBudget: number
}

function buildProgress(state: ReportState, query: SearchQuery, toolsUsed: number, cfg: ResolvedAIAgentConfig): ProgressFields {
    return {
        yielded: state.yielded,
        target: query.maxResults,
        toolsUsed,
        toolBudget: cfg.maxToolCalls,
    }
}

function buildSystemMessage(
    query: SearchQuery,
    phase: AgentPhase,
    cfg: ResolvedAIAgentConfig,
): ChatCompletionMessageParam {
    const role = buildRolePrompt(query, cfg)
    let phaseBlock: string
    switch (phase) {
        case 'recon': phaseBlock = buildReconInstructions(query); break
        case 'plan': phaseBlock = buildPlanInstructions(); break
        case 'execute': phaseBlock = buildExecuteInstructions(query); break
    }
    return { role: 'system', content: `${role}\n\n${phaseBlock}` }
}

export interface AgentToolCallInfo {
    name: string
    /** Full JSON-stringified arguments. Consumers should truncate for
     *  display — keeping it intact here so structured listeners (e.g.
     *  audit logs) get the unabridged value. */
    args: string
    durationMs: number
    ok: boolean
    error?: string
}

export interface AgentLoopHooks {
    onToolCall?: (info: AgentToolCallInfo) => void
    /** When this aborts, the loop unwinds silently — the in-flight LLM
     *  request is cancelled (via OpenAI SDK's `signal` option), pending
     *  tool calls return immediately, and `runAgentLoop` returns without
     *  logging an error. The outer source's `loopPromise.catch` therefore
     *  never sees an abort. */
    signal?: AbortSignal
}

/** True when an error came from `signal.abort()` propagating through the
 *  OpenAI SDK or a tool's HTTP layer (axios). Both rethrow with `name`
 *  set to one of these values; checking `signal.aborted` is a fallback
 *  for tools that swallow the underlying error. */
function isAbortError(e: any, signal?: AbortSignal): boolean {
    if (signal?.aborted) return true
    const name = e?.name
    return name === 'APIUserAbortError' || name === 'AbortError' || name === 'CanceledError'
}

export async function runAgentLoop(
    client: OpenAI,
    query: SearchQuery,
    queue: AsyncQueue<OrgData>,
    state: ReportState,
    cfg: ResolvedAIAgentConfig,
    hooks?: AgentLoopHooks,
): Promise<void> {
    const signal = hooks?.signal

    let phase: AgentPhase = 'recon'
    let toolCallsUsed = 0
    let reconSearches = 0
    let executePhaseTurnsSinceLastPlan = 0
    let turn = 0
    const startTime = Date.now()
    /** Per-run cache of (tool, args) → successful result. Cache hits are
     *  free: they don't increment toolCallsUsed or reconSearches. Errors
     *  are not cached so transient blips stay retriable. */
    const seenResults = new Map<string, unknown>()
    let planPinned = false

    const extractorRunner: ExtractorRunner | undefined = cfg.extractor
        ? (input, sig) => runExtractor(input, cfg.extractor!, sig)
        : undefined

    const messages: ChatCompletionMessageParam[] = [
        buildSystemMessage(query, 'recon', cfg),
        { role: 'user', content: buildUserPrompt(query) },
    ]

    let tools = await buildTools(query, queue, state, phase, { extractorRunner })
    let toolByName = new Map(tools.map(t => [t.name, t]))

    function pushToolResult(id: string, result: any) {
        const progress = buildProgress(state, query, toolCallsUsed, cfg)
        const wrapped = { ...(result ?? {}), progress }
        messages.push({ role: 'tool', tool_call_id: id, content: JSON.stringify(wrapped) })
    }
    function pushToolError(id: string, error: string) {
        pushToolResult(id, { error })
    }
    async function transitionToPlan(reason: string) {
        log.info(`ai-agent.loop: recon→plan after ${reconSearches} searches (${reason})`)
        phase = 'plan'
        messages[0] = buildSystemMessage(query, 'plan', cfg)
        tools = await buildTools(query, queue, state, 'plan', { extractorRunner })
        toolByName = new Map(tools.map(t => [t.name, t]))
    }

    log.debug(`ai-agent.loop: starting phase=recon model=${cfg.model} maxToolCalls=${cfg.maxToolCalls}`)

    while (true) {
        if (signal?.aborted) return
        if (Date.now() - startTime > cfg.totalTimeoutMs) {
            log.warn(`ai-agent.loop: total timeout (${cfg.totalTimeoutMs}ms) exceeded after ${turn} turns, ${toolCallsUsed} tool calls`)
            return
        }

        if ((phase as AgentPhase) === 'recon') {
            turn++
            const requestTools: ChatCompletionTool[] = tools.map(toOpenAISchema)
            const reqStart = Date.now()
            let response
            try {
                response = await client.chat.completions.create(
                    {
                        model: cfg.model,
                        temperature: cfg.temperature,
                        messages,
                        tools: requestTools,
                        tool_choice: 'required',
                    },
                    { signal },
                )
            } catch (e: any) {
                if (isAbortError(e, signal)) return
                log.error(`ai-agent.loop: LLM request failed (recon turn ${turn}): ${e.message ?? e}`)
                return
            }
            log.trace(`ai-agent.loop: recon turn ${turn} response in ${Date.now() - reqStart}ms`)

            const choice = response.choices?.[0]
            if (!choice) { log.warn('ai-agent.loop: LLM returned no choices'); return }
            const assistantMsg = choice.message
            messages.push(assistantMsg as ChatCompletionMessageParam)

            const toolCalls = assistantMsg.tool_calls ?? []
            if (toolCalls.length === 0) {
                log.warn(`ai-agent.loop: recon turn ${turn} produced no tool call — forcing transition to plan`)
                await transitionToPlan('recon-no-tool-call')
                continue
            }

            for (const call of toolCalls) {
                if (call.type !== 'function') {
                    pushToolError(call.id, 'unsupported tool call type')
                    continue
                }
                const name = call.function.name
                if (name !== 'web_search' && name !== 'end_recon') {
                    log.warn(`ai-agent.loop: recon phase rejected tool ${name}`)
                    pushToolError(call.id, 'recon phase: only web_search and end_recon allowed')
                    continue
                }

                let parsed: any
                try { parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {} }
                catch (e: any) { pushToolError(call.id, `invalid arguments: ${e.message ?? e}`); continue }

                if (name === 'end_recon') {
                    const tool = toolByName.get('end_recon')!
                    const result = await tool.handler(parsed, signal)
                    pushToolResult(call.id, result)
                    await transitionToPlan('end_recon-called')
                    break
                }

                // web_search in recon — check cache first (free hit, no budget cost).
                const dedupKey = `${name}:${canonicalJson(parsed)}`
                if (seenResults.has(dedupKey)) {
                    const cached = seenResults.get(dedupKey)
                    log.debug(`ai-agent.loop: ${name} cache hit (recon), replaying`)
                    hooks?.onToolCall?.({ name, args: JSON.stringify(parsed), durationMs: 0, ok: true })
                    pushToolResult(call.id, cached)
                    continue
                }

                if (toolCallsUsed >= cfg.maxToolCalls) {
                    pushToolError(call.id, 'max tool calls reached, transition to plan')
                    await transitionToPlan('budget-exhausted-in-recon')
                    break
                }
                toolCallsUsed++
                reconSearches++

                const tool = toolByName.get('web_search')!
                const callStart = Date.now()
                const result = await executeWithTimeout(tool, parsed, cfg.toolTimeoutMs, signal)
                if (signal?.aborted) return
                const durationMs = Date.now() - callStart
                if (!result?.error) seenResults.set(dedupKey, result)
                hooks?.onToolCall?.({ name, args: JSON.stringify(parsed), durationMs, ok: !result?.error, error: result?.error })
                pushToolResult(call.id, result)

                if (reconSearches >= RECON_BUDGET) {
                    log.warn(`ai-agent.loop: recon budget (${RECON_BUDGET}) exhausted, forcing plan phase`)
                    messages.push({ role: 'user', content: 'Recon budget exhausted. Write your plan now.' })
                    await transitionToPlan('recon-budget-exhausted')
                    break
                }
            }
            continue
        }

        if ((phase as AgentPhase) === 'plan') {
            turn++
            const reqStart = Date.now()
            let response
            try {
                response = await client.chat.completions.create(
                    {
                        model: cfg.model,
                        temperature: cfg.temperature,
                        messages,
                        tool_choice: 'none',
                    },
                    { signal },
                )
            } catch (e: any) {
                if (isAbortError(e, signal)) return
                log.error(`ai-agent.loop: LLM request failed (plan turn ${turn}): ${e.message ?? e}`)
                return
            }
            log.trace(`ai-agent.loop: plan turn ${turn} response in ${Date.now() - reqStart}ms`)

            const choice = response.choices?.[0]
            if (!choice) { log.warn('ai-agent.loop: LLM returned no choices'); return }
            const assistantMsg = choice.message
            messages.push(assistantMsg as ChatCompletionMessageParam)

            const content = (typeof assistantMsg.content === 'string' ? assistantMsg.content : '') ?? ''
            let planText = extractPlan(content)
            if (!planText) {
                log.warn(`ai-agent.loop: planning turn produced no <plan>...</plan> tags (content len=${content.length}); re-prompting`)
                messages.push({ role: 'user', content: 'Wrap your plan in <plan>...</plan> tags. Output the plan now.' })
                let retry
                try {
                    retry = await client.chat.completions.create(
                        { model: cfg.model, temperature: cfg.temperature, messages, tool_choice: 'none' },
                        { signal },
                    )
                } catch (e: any) {
                    if (isAbortError(e, signal)) return
                    log.error(`ai-agent.loop: plan re-prompt failed: ${e.message ?? e}`)
                    return
                }
                const retryChoice = retry.choices?.[0]
                if (!retryChoice) return
                const retryMsg = retryChoice.message
                messages.push(retryMsg as ChatCompletionMessageParam)
                const retryContent = (typeof retryMsg.content === 'string' ? retryMsg.content : '') ?? ''
                planText = extractPlan(retryContent) || retryContent || ''
                if (!extractPlan(retryContent)) {
                    log.warn(`ai-agent.loop: plan re-prompt also returned no tags; using raw content as plan (len=${retryContent.length})`)
                }
            }

            const pin = buildPlanPin(planText)
            if (planPinned) {
                messages[1] = pin as ChatCompletionMessageParam
                log.debug(`ai-agent.loop: plan pin replaced`)
            } else {
                messages.splice(1, 0, pin as ChatCompletionMessageParam)
                planPinned = true
                log.debug(`ai-agent.loop: plan pin inserted`)
            }
            log.info(`ai-agent.loop: plan→execute, plan ${planText.length} chars`)
            // Full plan dump — multi-line so log readers see the whole text
            // verbatim. Use an explicit divider so the plan stands out from
            // the surrounding tool-call lines.
            log.info(`ai-agent.loop: ── plan ──\n${planText}\n── /plan ──`)

            phase = 'execute'
            executePhaseTurnsSinceLastPlan = 0
            messages[0] = buildSystemMessage(query, 'execute', cfg)
            tools = await buildTools(query, queue, state, 'execute', { extractorRunner })
            toolByName = new Map(tools.map(t => [t.name, t]))
            continue
        }

        if ((phase as AgentPhase) === 'execute') {
            turn++
            executePhaseTurnsSinceLastPlan++
            const requestTools: ChatCompletionTool[] = tools.map(toOpenAISchema)
            const reqStart = Date.now()
            let response
            try {
                response = await client.chat.completions.create(
                    {
                        model: cfg.model,
                        temperature: cfg.temperature,
                        messages,
                        tools: requestTools,
                        tool_choice: 'auto',
                    },
                    { signal },
                )
            } catch (e: any) {
                if (isAbortError(e, signal)) return
                log.error(`ai-agent.loop: LLM request failed (execute turn ${turn}): ${e.message ?? e}`)
                return
            }
            log.trace(`ai-agent.loop: execute turn ${turn} response in ${Date.now() - reqStart}ms`)

            const choice = response.choices?.[0]
            if (!choice) { log.warn('ai-agent.loop: LLM returned no choices'); return }
            const assistantMsg = choice.message
            messages.push(assistantMsg as ChatCompletionMessageParam)

            const toolCalls = assistantMsg.tool_calls ?? []
            if (toolCalls.length === 0) {
                log.info(`ai-agent.loop: agent finished after ${turn} turns, ${toolCallsUsed} tool calls`)
                return
            }

            let revisedThisTurn = false
            for (const call of toolCalls) {
                if (revisedThisTurn) break
                if (call.type !== 'function') {
                    pushToolError(call.id, 'unsupported tool call type')
                    continue
                }
                const name = call.function.name

                let parsed: any
                try { parsed = call.function.arguments ? JSON.parse(call.function.arguments) : {} }
                catch (e: any) { pushToolError(call.id, `invalid arguments: ${e.message ?? e}`); continue }

                if (name === 'revise_plan') {
                    if (executePhaseTurnsSinceLastPlan < REVISE_MIN_EXECUTE_TURNS) {
                        log.debug(`ai-agent.loop: revise_plan rejected (only ${executePhaseTurnsSinceLastPlan} execute turns elapsed)`)
                        pushToolError(call.id, `revise_plan unavailable: give the current plan at least ${REVISE_MIN_EXECUTE_TURNS} execute turns before revising. Try the plan; if it still fails, revise then.`)
                        continue
                    }
                    const tool = toolByName.get('revise_plan')!
                    const result = await tool.handler(parsed, signal)
                    pushToolResult(call.id, result)
                    log.warn(`ai-agent.loop: execute→plan via revise_plan after ${executePhaseTurnsSinceLastPlan} turns. reason: ${parsed?.reason ?? '(none)'}`)
                    phase = 'plan'
                    messages[0] = buildSystemMessage(query, 'plan', cfg)
                    tools = await buildTools(query, queue, state, 'plan', { extractorRunner })
                    toolByName = new Map(tools.map(t => [t.name, t]))
                    revisedThisTurn = true
                    continue
                }

                const tool = toolByName.get(name)
                if (!tool) {
                    log.warn(`ai-agent.loop: agent called unknown tool "${name}"`)
                    pushToolError(call.id, `unknown tool "${name}"`)
                    continue
                }

                // Cache replay path: cacheable tools return prior result for free.
                const dedupKey = `${tool.name}:${canonicalJson(parsed)}`
                const cacheable = !NON_CACHEABLE_TOOLS.has(tool.name)
                if (cacheable && seenResults.has(dedupKey)) {
                    const cached = seenResults.get(dedupKey)
                    log.debug(`ai-agent.loop: ${tool.name} cache hit, replaying`)
                    hooks?.onToolCall?.({ name: tool.name, args: JSON.stringify(parsed), durationMs: 0, ok: true })
                    pushToolResult(call.id, cached)
                    continue
                }

                if (toolCallsUsed >= cfg.maxToolCalls) {
                    pushToolError(call.id, 'max tool calls reached, wrap up with report_results')
                    continue
                }
                toolCallsUsed++

                const callStart = Date.now()
                const result = await executeWithTimeout(tool, parsed, cfg.toolTimeoutMs, signal)
                if (signal?.aborted) return
                const durationMs = Date.now() - callStart
                if (result?.error) log.warn(`ai-agent.loop: ${tool.name} returned error: ${result.error}`)
                else if (cacheable) seenResults.set(dedupKey, result)
                hooks?.onToolCall?.({ name: tool.name, args: JSON.stringify(parsed), durationMs, ok: !result?.error, error: result?.error })
                pushToolResult(call.id, result)
            }
            continue
        }

        log.error('ai-agent.loop: unknown phase')
        return
    }
}

function extractPlan(content: string): string {
    const match = /<plan>([\s\S]+?)<\/plan>/i.exec(content)
    if (match) return match[1].trim()
    return ''
}

export { NON_CACHEABLE_TOOLS }

/** Stable JSON serialization with object keys sorted recursively. Two
 *  argument objects that differ only in key order produce the same string,
 *  so the dedup set treats them as the same call. */
function canonicalJson(v: unknown): string {
    if (v === null || typeof v !== 'object') return JSON.stringify(v)
    if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']'
    const keys = Object.keys(v as Record<string, unknown>).sort()
    return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalJson((v as any)[k])).join(',') + '}'
}

async function executeWithTimeout(tool: Tool, args: any, timeoutMs: number, signal?: AbortSignal): Promise<any> {
    if (signal?.aborted) return { error: 'cancelled' }

    let timer: NodeJS.Timeout | undefined
    const timeoutPromise = new Promise<any>(resolve => {
        timer = setTimeout(() => {
            log.warn(`ai-agent.loop: tool "${tool.name}" timeout after ${timeoutMs}ms`)
            resolve({ error: `tool "${tool.name}" timeout after ${timeoutMs}ms` })
        }, timeoutMs)
    })
    let abortListener: (() => void) | undefined
    const abortPromise = signal
        ? new Promise<any>(resolve => {
            abortListener = () => resolve({ error: 'cancelled' })
            signal.addEventListener('abort', abortListener, { once: true })
        })
        : null
    try {
        const handlerResult = tool.handler(args, signal).catch(e => {
            if (isAbortError(e, signal)) return { error: 'cancelled' }
            return { error: String(e?.message ?? e) }
        })
        const racers: Promise<any>[] = [handlerResult, timeoutPromise]
        if (abortPromise) racers.push(abortPromise)
        return await Promise.race(racers)
    } finally {
        if (timer) clearTimeout(timer)
        if (abortListener) signal?.removeEventListener('abort', abortListener)
    }
}
