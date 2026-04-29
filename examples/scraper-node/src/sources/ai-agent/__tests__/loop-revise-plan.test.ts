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

const baseQuery: SearchQuery = { query: 'q', city: 'СПб', sources: [], maxResults: 5 }
const cfg: ResolvedAIAgentConfig = {
    model: 'test', temperature: 0, baseUrl: 'http://x', apiKey: '',
    maxToolCalls: 25, toolTimeoutMs: 1000, totalTimeoutMs: 60_000,
    maxToolCallsPerOrg: 5,
    extractor: null,
}

function callMsg(name: string, args: object, id = 'c') {
    return { role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }
}
const finishMsg = { role: 'assistant', content: 'done', tool_calls: [] }

describe('runAgentLoop — revise_plan blocking', () => {
    it('rejects revise_plan called on the first execute turn', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('revise_plan', { reason: 'bad plan' }, 'rp1'),
            callMsg('parse_html', { html: '<a href="tel:+71234567890">x</a>', selector: 'a' }, 't1'),
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        // The 4th request comes after the blocked revise_plan; it should still be in execute phase.
        const reqAfterBlocked = client.requests[3]
        expect(reqAfterBlocked.tool_choice).toBe('auto')
        const blockedResult = reqAfterBlocked.messages.find((m: any) => m.role === 'tool' && m.tool_call_id === 'rp1')
        expect(blockedResult).toBeDefined()
        expect(blockedResult.content).toMatch(/give the current plan at least 2 execute turns/)
    })

    it('allows revise_plan after 2 execute turns and replaces pin in place', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>plan A</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),     // execute turn 1
            callMsg('parse_html', { html: '<y/>', selector: 'y' }, 't2'),     // execute turn 2
            callMsg('revise_plan', { reason: 'A failed' }, 'rp1'),            // execute turn 3 — allowed
            { role: 'assistant', content: '<plan>plan B</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        // After revise, the next plan request, then final execute. The execute-after-replan
        // request's messages[1] should be plan B's pin.
        const finalReq = client.requests[client.requests.length - 1]
        expect(finalReq.messages[1].role).toBe('system')
        expect(finalReq.messages[1].content).toContain('plan B')
        expect(finalReq.messages[1].content).not.toContain('plan A')
    })
})
