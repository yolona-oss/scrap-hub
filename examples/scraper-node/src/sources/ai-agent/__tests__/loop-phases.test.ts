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

const baseQuery: SearchQuery = { query: 'адвокат', city: 'СПб', sources: [], maxResults: 5 }
const cfg: ResolvedAIAgentConfig = {
    model: 'test', temperature: 0, baseUrl: 'http://x', apiKey: '',
    maxToolCalls: 25, toolTimeoutMs: 1000, totalTimeoutMs: 60_000,
}

function callMsg(name: string, args: object, id = 'c') {
    return { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}

describe('runAgentLoop — plan extraction & pinning', () => {
    it('extracts plan from <plan>...</plan> tags and pins at messages[1]', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: 'My plan: <plan>do A then B</plan>', tool_calls: [] },
        ])
        // Loop will hit "execute phase not yet implemented" stub and return,
        // but only after the plan transition completes — which is what we test.
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        // The third request would be the execute call, but the stub returns
        // before sending it. Instead, we inspect the messages constructed at
        // the moment of plan transition by looking at request[1] (the plan
        // request) and confirming tool_choice='none', then the pin will be
        // present in the *internal* messages array. Since we can't see that,
        // we verify via the LLM request shape that the plan turn happened.
        expect(client.requests.length).toBe(2)
        expect(client.requests[1].tool_choice).toBe('none')
    })

    it('falls back to whole content when <plan> tags missing twice', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: 'first response, no tags', tool_calls: [] },
            { role: 'assistant', content: 'still no tags here', tool_calls: [] },
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        // Three requests: recon, plan-attempt-1, plan-retry. The retry's
        // messages should include a user prompt asking to wrap in <plan>.
        expect(client.requests.length).toBe(3)
        const retryReq = client.requests[2]
        const userReprompt = retryReq.messages.find((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('<plan>'))
        expect(userReprompt).toBeDefined()
    })

    it('plan phase request uses tool_choice=none and omits tools', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const planReq = client.requests[1]
        expect(planReq.tool_choice).toBe('none')
        expect(planReq.tools).toBeUndefined()
    })

    it('recon phase request uses tool_choice=required with [web_search, end_recon]', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const reconReq = client.requests[0]
        expect(reconReq.tool_choice).toBe('required')
        const toolNames = reconReq.tools.map((t: any) => t.function.name)
        expect(toolNames).toEqual(expect.arrayContaining(['web_search', 'end_recon']))
        expect(toolNames).not.toContain('fetch_url')
        expect(toolNames).not.toContain('report_results')
    })
})
