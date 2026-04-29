import { runExtractor } from '../loop'
import type { ExtractorInput } from '../types'
import type { ResolvedExtractorConfig } from '../config'
import type { OpenAI } from 'openai'

const INPUT: ExtractorInput = {
    url: 'https://x',
    pageType: 'org-site',
    cleanedText: 'About us...',
    candidateBlocks: [
        { selector: 'footer', text: 'footer text +7 (812) 100-10-10', tels: ['+78121001010'], mails: [] },
    ],
    jsonLdBlobs: [],
    knownGoals: ['phone'],
    partialResult: { phones: [], emails: [], addresses: [], candidateName: '' },
}

const CFG: ResolvedExtractorConfig = {
    enabled: true,
    baseUrl: 'http://x/v1',
    apiKey: undefined,
    model: 'qwen-test',
    temperature: 0.1,
    maxToolCallsPerPage: 8,
    timeoutMs: 45000,
    maxRefetches: 3,
}

function mockClient(responses: Array<{ tool_calls?: any[], content?: string | null }>): OpenAI {
    let idx = 0
    return {
        chat: {
            completions: {
                async create() {
                    const r = responses[idx++] ?? { content: '' }
                    return {
                        choices: [{
                            message: {
                                role: 'assistant',
                                content: r.content ?? null,
                                tool_calls: r.tool_calls,
                            },
                            finish_reason: r.tool_calls ? 'tool_calls' : 'stop',
                        }],
                    } as any
                },
            },
        },
    } as any
}

describe('runExtractor', () => {
    it('terminates on report_extraction', async () => {
        const client = mockClient([
            {
                tool_calls: [{
                    id: 't1', type: 'function',
                    function: {
                        name: 'report_extraction',
                        arguments: JSON.stringify({
                            phones: ['+78121001010'], emails: [], addresses: [],
                            candidateName: 'X', confidence: 0.85,
                        }),
                    },
                }],
            },
        ])
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('extraction')
        if (r.outcome === 'extraction') {
            expect(r.phones).toContain('+78121001010')
            expect(r.confidence).toBe(0.85)
        }
        expect(r.toolCallsUsed).toBe(1)
    })

    it('terminates on report_incomplete', async () => {
        const client = mockClient([
            {
                tool_calls: [{
                    id: 't1', type: 'function',
                    function: {
                        name: 'report_incomplete',
                        arguments: JSON.stringify({ reason: 'no contacts visible' }),
                    },
                }],
            },
        ])
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('incomplete')
        if (r.outcome === 'incomplete') expect(r.reason).toMatch(/no contacts/)
    })

    it('handles non-terminal tool then terminal', async () => {
        const client = mockClient([
            {
                tool_calls: [{
                    id: 't1', type: 'function',
                    function: { name: 'read_blocks', arguments: JSON.stringify({ selector: 'footer' }) },
                }],
            },
            {
                tool_calls: [{
                    id: 't2', type: 'function',
                    function: {
                        name: 'report_extraction',
                        arguments: JSON.stringify({
                            phones: ['+78121001010'], candidateName: 'X', confidence: 0.7,
                        }),
                    },
                }],
            },
        ])
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('extraction')
        expect(r.toolCallsUsed).toBe(2)
    })

    it('terminates with incomplete on budget exhaustion', async () => {
        const responses: any[] = []
        // 9 non-terminal tool calls — exceeds maxToolCallsPerPage=8
        for (let i = 0; i < 9; i++) {
            responses.push({
                tool_calls: [{
                    id: `t${i}`, type: 'function',
                    function: { name: 'read_blocks', arguments: JSON.stringify({ selector: '*' }) },
                }],
            })
        }
        const client = mockClient(responses)
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('incomplete')
        if (r.outcome === 'incomplete') expect(r.reason).toMatch(/budget|exhaust/i)
        expect(r.toolCallsUsed).toBe(8)
    })

    it('terminates with incomplete when model returns no tool call', async () => {
        const client = mockClient([{ content: 'I cannot extract anything' }])
        const r = await runExtractor(INPUT, CFG, undefined, { client })
        expect(r.outcome).toBe('incomplete')
    })

    it('respects abort signal', async () => {
        const ac = new AbortController()
        ac.abort()
        const client = mockClient([])
        const r = await runExtractor(INPUT, CFG, ac.signal, { client })
        expect(r.outcome).toBe('incomplete')
        if (r.outcome === 'incomplete') expect(r.reason).toMatch(/abort/i)
    })

    it('threads refetch through to a same-origin URL and reaches terminal', async () => {
        const fakeClassify = jest.fn(async (url: string) => ({
            url,
            pageType: 'org-site' as const,
            confidence: 0.85,
            signals: [],
            cleanedText: 'fetched contacts page',
            candidateBlocks: [],
            jsonLdBlobs: [],
            contactCandidates: [],
            aggregatorCandidates: [],
            branchCandidates: [],
        }))
        const client = mockClient([
            {
                tool_calls: [{
                    id: 't1', type: 'function',
                    function: {
                        name: 'refetch',
                        arguments: JSON.stringify({ url: 'https://x/contacts', reason: 'contact-page' }),
                    },
                }],
            },
            {
                tool_calls: [{
                    id: 't2', type: 'function',
                    function: {
                        name: 'report_extraction',
                        arguments: JSON.stringify({
                            phones: ['+78121001010'], candidateName: 'X', confidence: 0.7,
                        }),
                    },
                }],
            },
        ])
        const r = await runExtractor(
            { ...INPUT, url: 'https://x/' },
            CFG,
            undefined,
            { client, classifyPage: fakeClassify },
        )
        expect(r.outcome).toBe('extraction')
        expect(fakeClassify).toHaveBeenCalledWith('https://x/contacts')
    })

    it('rejects cross-origin refetch but loop continues', async () => {
        const fakeClassify = jest.fn(async () => ({
            url: 'https://x/',
            pageType: 'org-site' as const,
            confidence: 0.85,
            signals: [],
            cleanedText: '',
            candidateBlocks: [],
            jsonLdBlobs: [],
            contactCandidates: [],
            aggregatorCandidates: [],
            branchCandidates: [],
        }))
        const client = mockClient([
            {
                tool_calls: [{
                    id: 't1', type: 'function',
                    function: {
                        name: 'refetch',
                        arguments: JSON.stringify({ url: 'https://other.ru/', reason: 'other' }),
                    },
                }],
            },
            {
                tool_calls: [{
                    id: 't2', type: 'function',
                    function: {
                        name: 'report_incomplete',
                        arguments: JSON.stringify({ reason: 'cross-origin blocked' }),
                    },
                }],
            },
        ])
        const r = await runExtractor(
            { ...INPUT, url: 'https://x/' },
            CFG,
            undefined,
            { client, classifyPage: fakeClassify },
        )
        expect(r.outcome).toBe('incomplete')
        expect(fakeClassify).not.toHaveBeenCalled() // Cross-origin short-circuits before fetch.
    })
})
