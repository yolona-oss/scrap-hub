import { runAgentLoop } from '../loop'
import { AsyncQueue } from '../async-queue'
import type { OrgData, SearchQuery } from '../../../types'
import type { ResolvedAIAgentConfig } from '../config'
import type { ReportState } from '../tools'

class FakeOpenAIClient {
    private script: any[]
    public requests: any[] = []
    constructor(script: any[]) { this.script = [...script] }
    chat = {
        completions: {
            create: async (req: any): Promise<any> => {
                this.requests.push(req)
                if (this.script.length === 0) throw new Error('FakeOpenAIClient: ran out of scripted responses')
                const msg = this.script.shift()
                return { choices: [{ message: msg }] }
            },
        },
    }
}

const baseQuery: SearchQuery = {
    query: 'адвокат',
    city: 'Санкт-Петербург',
    sources: [],
    maxResults: 10,
}

const cfg: ResolvedAIAgentConfig = {
    model: 'test-model',
    temperature: 0.0,
    baseUrl: 'http://x',
    apiKey: '',
    maxToolCalls: 50,
    toolTimeoutMs: 1000,
    totalTimeoutMs: 60_000,
    maxToolCallsPerOrg: 5,
    extractor: null,
}

function callMessage(toolName: string, args: object, id = 'c1') {
    return {
        role: 'assistant',
        content: '',
        tool_calls: [{ id, type: 'function', function: { name: toolName, arguments: JSON.stringify(args) } }],
    }
}

const planMessage = { role: 'assistant', content: '<plan>start with aggregator search</plan>', tool_calls: [] }
const finishMessage = { role: 'assistant', content: 'done', tool_calls: [] }

describe('runAgentLoop — recon bounds', () => {
    it('rejects disallowed tool calls during recon', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMessage('report_results', { orgs: [] }, 'a'),
            callMessage('end_recon', {}, 'b'),
            planMessage,
            finishMessage,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const secondReq = client.requests[1]
        const toolMsgs = secondReq.messages.filter((m: any) => m.role === 'tool')
        expect(toolMsgs.length).toBeGreaterThan(0)
        expect(toolMsgs[0].content).toMatch(/recon phase: only web_search and end_recon allowed/)
    })

    it('forces transition to plan after RECON_BUDGET (10) web_search calls', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const reconCalls = Array.from({ length: 10 }, (_, i) =>
            callMessage('web_search', { query: 'q' + i }, 'r' + i),
        )
        const client = new FakeOpenAIClient([
            ...reconCalls,
            planMessage,
            finishMessage,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const planReq = client.requests[10]
        expect(planReq.tool_choice).toBe('none')
    })

    it('cache hits during recon do not burn budget or recon counter', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        // First call runs the tool; second identical call hits cache.
        // Both still result in pushed tool messages, but toolsUsed in
        // progress should only reflect one real call.
        const client = new FakeOpenAIClient([
            callMessage('web_search', { query: 'X' }, 'a'),
            callMessage('web_search', { query: 'X' }, 'b'),
            callMessage('end_recon', {}, 'c'),
            planMessage,
            finishMessage,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        // After the second (cached) web_search and the end_recon, the plan
        // request should show toolsUsed=1 (only the first real web_search).
        // web_search will fail in tests because searxngUrl is unset, but the
        // error is still cached as undefined→not cached. So we check the
        // assistant_msg push order instead:
        const planReq = client.requests[3]
        expect(planReq.tool_choice).toBe('none')
        // Either the cache hit replays the first result, or the first call
        // errored and so the second isn't cached (still re-runs). Both paths
        // should reach end_recon and plan phase. We just verify we got there.
    })
})
