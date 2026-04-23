import { makeHelpBuiltIn } from '../help'
import { ManifestAggregator, AggregatedManifest } from '../../pool/manifest-aggregator'

const mf = (nodeId: string, name: string, v: string): AggregatedManifest => ({
    nodeId, nodeName: nodeId, version: '1.0.0',
    commands: [{ name, compatibilityId: `com.ex.${name}`, version: v, description: '', args: [], aliases: [] }],
    services: [], configs: [], hardware: {}, metrics: {},
})

describe('/help built-in', () => {
    it('renders built-ins and pool commands together', async () => {
        const agg = new ManifestAggregator()
        agg.attach(mf('A', 'scraper', '1.0.0'))
        agg.attach(mf('B', 'echo',    '2.3.1'))
        const help = makeHelpBuiltIn({
            aggregator: agg,
            builtInNames: () => ['node', 'help'],
        })

        const r = await help({ command: 'help', args: {}, userId: 'u', uiHandle: null })
        expect(r.success).toBe(true)
        expect(r.markup.text).toContain('/help\tbuilt-in')
        expect(r.markup.text).toContain('/node\tbuilt-in')
        expect(r.markup.text).toContain('/scraper\tnodes: A@1.0.0')
        expect(r.markup.text).toContain('/echo\tnodes: B@2.3.1')
    })

    it('handles an empty aggregator and no built-ins', async () => {
        const help = makeHelpBuiltIn({
            aggregator: new ManifestAggregator(),
            builtInNames: () => [],
        })
        const r = await help({ command: 'help', args: {}, userId: 'u', uiHandle: null })
        expect(r.markup.text).toMatch(/no commands/)
    })

    it('lists multiple peer nodes for the same command', async () => {
        const agg = new ManifestAggregator()
        agg.attach(mf('A', 'scraper', '1.0.0'))
        agg.attach(mf('B', 'scraper', '1.2.0'))
        const help = makeHelpBuiltIn({
            aggregator: agg,
            builtInNames: () => [],
        })
        const r = await help({ command: 'help', args: {}, userId: 'u', uiHandle: null })
        expect(r.markup.text).toContain('A@1.0.0')
        expect(r.markup.text).toContain('B@1.2.0')
    })
})
