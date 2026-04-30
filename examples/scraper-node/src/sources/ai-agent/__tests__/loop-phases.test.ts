import { runAgentLoop } from '../loop'
import { AsyncQueue } from '../async-queue'
import type { OrgData, SearchQuery } from '../../../types'
import type { ResolvedAIAgentConfig } from '../config'
import type { ReportState } from '../tools'
import { makeStubDeps } from './loop-test-helpers'

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
    maxToolCallsPerOrg: 5,
    extractor: null,
}

function callMsg(name: string, args: object, id = 'c') {
    return { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}

describe('runAgentLoop — plan extraction & pinning', () => {
    it('extracts plan from <plan>...</plan> tags and pins at messages[1]', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: 'My plan: <plan>do A then B</plan>', tool_calls: [] },
            finishMsg,  // first harvest turn — agent finishes immediately
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg, makeStubDeps())

        // Three requests: recon, plan, harvest. The harvest request's
        // messages[1] should be the plan pin.
        expect(client.requests.length).toBe(3)
        const harvestReq = client.requests[2]
        const pin = harvestReq.messages[1]
        expect(pin.role).toBe('system')
        expect(pin.content).toContain('Active research plan:')
        expect(pin.content).toContain('do A then B')
    })

    it('falls back to whole content when <plan> tags missing twice', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: 'first response, no tags', tool_calls: [] },
            { role: 'assistant', content: 'still no tags here', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg, makeStubDeps())

        // Four requests: recon, plan-attempt-1, plan-retry, harvest. The retry's
        // messages should include a user prompt asking to wrap in <plan>.
        expect(client.requests.length).toBe(4)
        const retryReq = client.requests[2]
        const userReprompt = retryReq.messages.find((m: any) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('<plan>'))
        expect(userReprompt).toBeDefined()
        // Harvest request's pin should contain the second response's content as fallback.
        const harvestReq = client.requests[3]
        expect(harvestReq.messages[1].content).toContain('still no tags here')
    })

    it('plan phase request uses tool_choice=none and omits tools', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg, makeStubDeps())

        const planReq = client.requests[1]
        expect(planReq.tool_choice).toBe('none')
        expect(planReq.tools).toBeUndefined()
    })

    it('recon phase request uses tool_choice=required with [web_search, end_recon]', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg, makeStubDeps())

        const reconReq = client.requests[0]
        expect(reconReq.tool_choice).toBe('required')
        const toolNames = reconReq.tools.map((t: any) => t.function.name)
        expect(toolNames).toEqual(expect.arrayContaining(['web_search', 'end_recon']))
        expect(toolNames).not.toContain('harvest_serp')
        expect(toolNames).not.toContain('list_orgs')
    })

    it('harvest phase request uses tool_choice=auto with harvest toolset', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg, makeStubDeps())

        const harvestReq = client.requests[2]
        expect(harvestReq.tool_choice).toBe('auto')
        const toolNames = harvestReq.tools.map((t: any) => t.function.name)
        expect(toolNames).toEqual(expect.arrayContaining([
            'web_search', 'harvest_serp', 'discover_org_candidates', 'revise_plan',
        ]))
        // Deepen+review tools must NOT leak into harvest.
        expect(toolNames).not.toContain('list_orgs')
        expect(toolNames).not.toContain('pick_next_partial')
        expect(toolNames).not.toContain('deepen_org')
        expect(toolNames).not.toContain('freeze_org')
        // Removed tools must NOT exist anywhere.
        expect(toolNames).not.toContain('report_results')
        expect(toolNames).not.toContain('fetch_url')
        expect(toolNames).not.toContain('parse_html')
        expect(toolNames).not.toContain('extract_contacts')
    })

    it('deepen+review phase request uses tool_choice=auto with the queue toolset', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }
        // Force a transition from harvest → deepen+review by exhausting harvest budget.
        // maxToolCalls=2 → harvestBudget=1; one harvest call triggers transition.
        const lowCfg = { ...cfg, maxToolCalls: 2 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('discover_org_candidates', { url: 'https://x' }, 'h1'),  // harvest, hits budget → transition
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, lowCfg, makeStubDeps())

        // Last request is the deepen+review turn (after auto-transition).
        const deepenReq = client.requests[client.requests.length - 1]
        expect(deepenReq.tool_choice).toBe('auto')
        const toolNames = deepenReq.tools.map((t: any) => t.function.name)
        expect(toolNames).toEqual(expect.arrayContaining([
            'list_orgs', 'pick_next_partial', 'deepen_org', 'freeze_org', 'revise_plan',
        ]))
        // Harvest tools must NOT bleed into deepen+review.
        expect(toolNames).not.toContain('web_search')
        expect(toolNames).not.toContain('harvest_serp')
        expect(toolNames).not.toContain('discover_org_candidates')
    })
})
