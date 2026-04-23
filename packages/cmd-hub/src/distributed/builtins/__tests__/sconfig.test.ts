import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { makeSConfigBuiltIn } from '../sconfig'
import { MongoAccountModuleStore } from '../sconfig-store'
import { ManifestAggregator, AggregatedManifest } from '../../pool/manifest-aggregator'

const mfWithConfig = (nodeId: string, moduleName: string): AggregatedManifest => ({
    nodeId, nodeName: nodeId, version: '1.0.0',
    commands: [], services: [],
    configs: [{ name: moduleName, scope: 'user', fields: [] }],
    hardware: {}, metrics: {},
})

describe('/sconfig built-in', () => {
    let rs: MongoMemoryReplSet

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('sconfig-builtin'))
    }, 120_000)
    afterAll(async () => { await mongoose.disconnect(); await rs.stop() })

    it('reads/writes per-user config scoped by userId', async () => {
        const store = new MongoAccountModuleStore()
        const agg = new ManifestAggregator()
        agg.attach(mfWithConfig('A', 'scraper'))
        const h = makeSConfigBuiltIn({ aggregator: agg, store })

        const r1 = await h({
            command: 'sconfig',
            args: { module: 'scraper', key: 'apiKey', value: 'alice-key' },
            userId: 'alice', uiHandle: null,
        })
        expect(r1.success).toBe(true)

        const r2 = await h({
            command: 'sconfig',
            args: { module: 'scraper', key: 'apiKey', value: 'bob-key' },
            userId: 'bob', uiHandle: null,
        })
        expect(r2.success).toBe(true)

        const aliceRead = await h({
            command: 'sconfig',
            args: { module: 'scraper', key: 'apiKey' },
            userId: 'alice', uiHandle: null,
        })
        expect(aliceRead.markup.text).toContain('alice-key')

        const bobRead = await h({
            command: 'sconfig',
            args: { module: 'scraper', key: 'apiKey' },
            userId: 'bob', uiHandle: null,
        })
        expect(bobRead.markup.text).toContain('bob-key')

        const unknownUserRead = await h({
            command: 'sconfig',
            args: { module: 'scraper', key: 'apiKey' },
            userId: 'carol', uiHandle: null,
        })
        expect(unknownUserRead.markup.text).toContain('(unset)')
    })

    it('refuses write when no node owns the module', async () => {
        const h = makeSConfigBuiltIn({
            aggregator: new ManifestAggregator(),
            store: new MongoAccountModuleStore(),
        })
        const r = await h({
            command: 'sconfig',
            args: { module: 'ghost', key: 'k', value: 'v' },
            userId: 'u', uiHandle: null,
        })
        expect(r.success).toBe(false)
    })
})
