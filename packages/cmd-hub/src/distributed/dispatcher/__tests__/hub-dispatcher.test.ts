import { HubDispatcher, BuiltInHandler } from '../hub-dispatcher'
import { ManifestAggregator, AggregatedManifest } from '../../pool/manifest-aggregator'
import { FakeCmdNodeClient } from '../../client/fake-cmd-node-client'
import type { InvokeServer } from '../../../grpc/generated/cmd_node'

const mf = (nodeId: string, name: string): AggregatedManifest => ({
    nodeId, nodeName: nodeId, version: '1.0.0',
    commands: [{ name, compatibilityId: 'cid', version: '1.0.0', description: '', args: [], aliases: [] }],
    services: [], configs: [], hardware: {}, metrics: {},
})

describe('HubDispatcher', () => {
    it('runs a built-in locally and never calls the node client', async () => {
        const agg = new ManifestAggregator()
        let clientCalled = false
        const client = new FakeCmdNodeClient(async () => { clientCalled = true })
        const help: BuiltInHandler = jest.fn(async () => ({
            success: true, markup: { text: 'help' },
        }))
        const disp = new HubDispatcher({ aggregator: agg, client })
        disp.registerBuiltIn('help', help)

        const r = await disp.handle({ command: 'help', args: {}, userId: 'u', uiHandle: null })
        expect(r.markup.text).toBe('help')
        expect(clientCalled).toBe(false)
    })

    it('routes to a pool node and streams events back', async () => {
        const agg = new ManifestAggregator()
        agg.attach(mf('A', 'scraper'))
        const client = new FakeCmdNodeClient(async (_n, _s, emit) => {
            emit({ seq: 1, message: { text: 'hi' } } as InvokeServer)
            emit({ seq: 2, done: { finalMessage: 'ok' } } as InvokeServer)
        })
        const disp = new HubDispatcher({ aggregator: agg, client })

        const events: InvokeServer[] = []
        const r = await disp.handle({
            command: 'scraper', args: {}, userId: 'u', uiHandle: null,
            onEvent: (e) => events.push(e),
        })

        expect(r.success).toBe(true)
        expect(r.markup.text).toBe('ok')
        expect(events).toHaveLength(2)
        expect(events[0].message?.text).toBe('hi')
        expect(events[1].done?.finalMessage).toBe('ok')
    })

    it('fails fast when no pool member exists', async () => {
        const disp = new HubDispatcher({
            aggregator: new ManifestAggregator(),
            client: new FakeCmdNodeClient(async () => undefined),
        })
        const r = await disp.handle({ command: 'nope', args: {}, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/no nodes available/)
    })

    it('nodeOverride routes to the named node when present in the pool', async () => {
        const agg = new ManifestAggregator()
        agg.attach(mf('A', 'scraper'))
        agg.attach(mf('B', 'scraper'))
        const seen: string[] = []
        const client = new FakeCmdNodeClient(async (nodeId, _s, emit) => {
            seen.push(nodeId)
            emit({ seq: 1, done: { finalMessage: '' } } as InvokeServer)
        })
        const disp = new HubDispatcher({ aggregator: agg, client })

        await disp.handle({
            command: 'scraper', args: {}, userId: 'u', uiHandle: null, nodeOverride: 'B',
        })
        expect(seen).toEqual(['B'])
    })

    it('nodeOverride fails fast when the named node is not in the pool', async () => {
        const agg = new ManifestAggregator()
        agg.attach(mf('A', 'scraper'))
        const disp = new HubDispatcher({
            aggregator: agg,
            client: new FakeCmdNodeClient(async () => undefined),
        })

        const r = await disp.handle({
            command: 'scraper', args: {}, userId: 'u', uiHandle: null, nodeOverride: 'Z',
        })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/not a peer/)
    })

    it('surfaces StreamError events as success=false', async () => {
        const agg = new ManifestAggregator()
        agg.attach(mf('A', 'scraper'))
        const client = new FakeCmdNodeClient(async (_n, _s, emit) => {
            emit({ seq: 1, error: { text: 'boom' } } as InvokeServer)
            emit({ seq: 2, done: { finalMessage: 'failed' } } as InvokeServer)
        })
        const disp = new HubDispatcher({ aggregator: agg, client })

        const r = await disp.handle({ command: 'scraper', args: {}, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toBe('failed')
    })
})
