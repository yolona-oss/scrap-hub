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
    maxToolCalls: 4, toolTimeoutMs: 1000, totalTimeoutMs: 60_000,
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
        const client = new FakeOpenAIClient([
            callMsg('web_search', { query: 'a' }, 'r1'),
            callMsg('end_recon', {}, 'r2'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

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

    it('budget prefix string is gone (no [budget: prefix anywhere)', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('web_search', { query: 'a' }, 'r1'),
            callMsg('end_recon', {}, 'r2'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),
            callMsg('parse_html', { html: '<y/>', selector: 'y' }, 't2'),
            callMsg('parse_html', { html: '<z/>', selector: 'z' }, 't3'),
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        for (const m of toolMsgs) {
            expect(m.content).not.toMatch(/^\[budget:/)
        }
    })

    it('end_recon and revise_plan do not increment toolsUsed', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('web_search', { query: 'a' }, 'r1'),               // toolsUsed=1
            callMsg('end_recon', {}, 'r2'),                             // signaling, no count
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),  // toolsUsed=2
            callMsg('parse_html', { html: '<y/>', selector: 'y' }, 't2'),  // toolsUsed=3
            callMsg('revise_plan', { reason: 'r' }, 'rp1'),                // signaling, no count
            { role: 'assistant', content: '<plan>p2</plan>', tool_calls: [] },
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        const lastToolMsg = toolMsgs[toolMsgs.length - 1]
        const lastProgress = JSON.parse(lastToolMsg.content).progress
        // 1 web_search + 2 parse_html = 3 real tool calls. end_recon and revise_plan don't count.
        expect(lastProgress.toolsUsed).toBe(3)
    })

    it('cache hit replays prior result without incrementing toolsUsed', async () => {
        const queue = new AsyncQueue<OrgData>()
        const state: ReportState = { yielded: 0 }
        const client = new FakeOpenAIClient([
            callMsg('end_recon', {}, 'r1'),
            { role: 'assistant', content: '<plan>p</plan>', tool_calls: [] },
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't1'),  // first call, toolsUsed=1
            callMsg('parse_html', { html: '<x/>', selector: 'x' }, 't2'),  // identical args → cache hit, no increment
            finishMsg,
        ])
        await runAgentLoop(client as any, baseQuery, queue, state, cfg)

        const finalReq = client.requests[client.requests.length - 1]
        const toolMsgs = finalReq.messages.filter((m: any) => m.role === 'tool')
        const lastProgress = JSON.parse(toolMsgs[toolMsgs.length - 1].content).progress
        expect(lastProgress.toolsUsed).toBe(1)
    })
})
