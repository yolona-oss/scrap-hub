import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { makeConfigBuiltIn } from '../config'
import { MongoSystemConfigStore } from '../config-store'
import { ManifestAggregator, AggregatedManifest } from '../../pool/manifest-aggregator'

const mfWithConfig = (nodeId: string, moduleName: string): AggregatedManifest => ({
    nodeId, nodeName: nodeId, version: '1.0.0',
    commands: [], services: [],
    configs: [{ name: moduleName, scope: 'system', fields: [] }],
    hardware: {}, metrics: {},
})

describe('/config built-in', () => {
    let rs: MongoMemoryReplSet

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('config-builtin'))
    }, 120_000)
    afterAll(async () => { await mongoose.disconnect(); await rs.stop() })

    it('lists modules, reads and writes with fan-out to owners', async () => {
        const store = new MongoSystemConfigStore()
        const agg = new ManifestAggregator()
        agg.attach(mfWithConfig('A', 'scraper'))
        agg.attach(mfWithConfig('B', 'scraper'))

        const reloadCalls: Array<{ nodeId: string; module: string }> = []
        const configReload = async (nodeId: string, module: string) => {
            reloadCalls.push({ nodeId, module })
        }

        const h = makeConfigBuiltIn({ aggregator: agg, store, configReload })

        const list = await h({ command: 'config', args: {}, userId: 'u', uiHandle: null })
        expect(list.markup.text).toContain('scraper')
        expect(list.markup.text).toMatch(/owners: [AB], [AB]/)

        const read0 = await h({
            command: 'config',
            args: { module: 'scraper', key: 'apiKey' },
            userId: 'u', uiHandle: null,
        })
        expect(read0.markup.text).toContain('(unset)')

        const write = await h({
            command: 'config',
            args: { module: 'scraper', key: 'apiKey', value: 'xyz' },
            userId: 'u', uiHandle: null,
        })
        expect(write.success).toBe(true)
        expect(reloadCalls.map((c) => c.nodeId).sort()).toEqual(['A', 'B'])

        const read1 = await h({
            command: 'config',
            args: { module: 'scraper', key: 'apiKey' },
            userId: 'u', uiHandle: null,
        })
        expect(read1.markup.text).toContain('xyz')

        const moduleList = await h({
            command: 'config',
            args: { module: 'scraper' },
            userId: 'u', uiHandle: null,
        })
        expect(moduleList.markup.text).toContain('apiKey=xyz')
    })

    it('refuses write when no node owns the module', async () => {
        const h = makeConfigBuiltIn({
            aggregator: new ManifestAggregator(),
            store: new MongoSystemConfigStore(),
            configReload: async () => undefined,
        })
        const r = await h({
            command: 'config',
            args: { module: 'ghost', key: 'k', value: 'v' },
            userId: 'u', uiHandle: null,
        })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/no node owns/)
    })
})
