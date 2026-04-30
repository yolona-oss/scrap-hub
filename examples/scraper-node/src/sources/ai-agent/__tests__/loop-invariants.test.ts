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

const baseQuery: SearchQuery = { query: 'q', city: 'СПб', sources: [], maxResults: 5 }
const cfg: ResolvedAIAgentConfig = {
    model: 'test', temperature: 0, baseUrl: 'http://x', apiKey: '',
    maxToolCalls: 4, toolTimeoutMs: 1000, totalTimeoutMs: 60_000,
    maxToolCallsPerOrg: 5,
    extractor: null,
}

function callMsg(name: string, args: object, id = 'c') {
    return { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }

describe('runAgentLoop — invariants', () => {
    it('every tool-role message has a progress field', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        // recon → plan → harvest (1 call) → deepen+review (list_orgs)
        const client = new FakeOpenAIClient([
            callMsg('web_search', { query: 'a' }, 'r1'),
            callMsg('end_recon', {}, 'r2'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('discover_org_candidates', { url: 'https://x' }, 'h1'),
            callMsg('list_orgs', {}, 'd1'),
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg, makeStubDeps())

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        expect(toolMsgs.length).toBeGreaterThan(0)
        for (const m of toolMsgs) {
            const parsed = JSON.parse(m.content)
            expect(parsed.progress).toBeDefined()
            expect(parsed.progress.target).toBe(5)
            expect(parsed.progress.toolBudget).toBe(4)
            expect(typeof parsed.progress.yielded).toBe('number')
            expect(typeof parsed.progress.toolsUsed).toBe('number')
        }
    })

    it('end_recon and revise_plan do not increment toolsUsed', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        // Plan: recon (1 web_search + end_recon) → plan → harvest (2 turns
        // before revise_plan is allowed; use list_orgs-equivalent in harvest)
        // → revise_plan → plan → harvest (1 more) → finish.
        // Counted tool calls: web_search(1) + discover_org_candidates(2) + harvest_serp not used.
        // revise_plan and end_recon don't count.
        const client = new FakeOpenAIClient([
            callMsg('web_search', { query: 'a' }, 'r1'),               // recon — toolsUsed=1
            callMsg('end_recon', {}, 'r2'),                             // signaling, no count
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('discover_org_candidates', { url: 'https://x' }, 'h1'),  // harvest turn 1 — toolsUsed=2 (also auto-triggers transition since maxToolCalls=4 → harvestBudget=2)
            // After auto-transition we are in deepen+review.
            callMsg('list_orgs', {}, 'd1'),                              // deepen turn 1 — toolsUsed=3
            callMsg('list_orgs', { status: 'partial' }, 'd2'),          // deepen turn 2
            callMsg('revise_plan', { reason: 'r' }, 'rp1'),             // signaling, no count
            { role: 'assistant', content: '<plan>p2</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg, makeStubDeps())

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        const lastToolMsg = toolMsgs[toolMsgs.length - 1]
        const lastProgress = JSON.parse(lastToolMsg.content).progress
        // 1 web_search + 1 discover_org_candidates + 2 list_orgs = 4 real tool calls.
        // end_recon and revise_plan do not count.
        expect(lastProgress.toolsUsed).toBe(4)
    })

    it('cache hit replays prior result without incrementing toolsUsed', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        // Use discover_org_candidates (cacheable). recon → plan → harvest:
        // first call counts as toolsUsed=1; second identical call is a cache
        // hit and must NOT increment.
        const localCfg = { ...cfg, maxToolCalls: 10 }  // harvestBudget=5, no transition during this test
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('discover_org_candidates', { url: 'https://x' }, 'h1'),  // harvest, toolsUsed=1
            callMsg('discover_org_candidates', { url: 'https://x' }, 'h2'),  // identical args → cache hit
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, localCfg, makeStubDeps())

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        const lastProgress = JSON.parse(toolMsgs[toolMsgs.length - 1].content).progress
        expect(lastProgress.toolsUsed).toBe(1)
    })
})
