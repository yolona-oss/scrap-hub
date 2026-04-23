import { makeNodeBuiltIn, NodeBuiltInDeps } from '../node'
import { CmdNodeRegistry } from '../../registry/cmd-node-registry'
import { ManifestAggregator } from '../../pool/manifest-aggregator'
import { InternalTokenVerifier } from '../../auth/internal-token-verifier'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'

describe('/node built-in', () => {
    let rs: MongoMemoryReplSet
    let deps: NodeBuiltInDeps

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('node-builtin'))
        deps = {
            registry: new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4) }),
            aggregator: new ManifestAggregator(),
        }
    }, 120_000)

    afterAll(async () => {
        await mongoose.disconnect()
        await rs.stop()
    })

    it('list shows every registered node', async () => {
        const { nodeId } = await deps.registry.provision({
            nodeName: 'a', certFingerprint: 'x', createdVia: 'cli', autoActivate: true,
        })
        const h = makeNodeBuiltIn(deps)
        const r = await h({ command: 'node', args: { sub: 'list' }, userId: 'u', uiHandle: null })
        expect(r.success).toBe(true)
        expect(r.markup.text).toContain(nodeId)
        expect(r.markup.text).toContain('ACTIVE')
    })

    it('approve transitions PENDING to ACTIVE', async () => {
        const { nodeId } = await deps.registry.provision({
            nodeName: 'b', certFingerprint: 'y', createdVia: 'manual', autoActivate: false,
        })
        const h = makeNodeBuiltIn(deps)
        const r = await h({ command: 'node', args: { sub: 'approve', id: nodeId }, userId: 'u', uiHandle: null })
        expect(r.success).toBe(true)
        expect((await deps.registry.get(nodeId))!.state).toBe('ACTIVE')
    })

    it('show surfaces the attached manifest when present', async () => {
        const { nodeId } = await deps.registry.provision({
            nodeName: 'c', certFingerprint: 'z', createdVia: 'cli', autoActivate: true,
        })
        deps.aggregator.attach({
            nodeId, nodeName: 'c', version: '1.0.0',
            commands: [{ name: 'scraper', compatibilityId: 'cid', version: '1.0.0', description: '', args: [], aliases: [] }],
            services: [], configs: [], hardware: {}, metrics: {},
        })
        const h = makeNodeBuiltIn(deps)
        const r = await h({ command: 'node', args: { sub: 'show', id: nodeId }, userId: 'u', uiHandle: null })
        expect(r.markup.text).toContain('scraper@1.0.0')
    })

    it('show returns clear error for missing id', async () => {
        const h = makeNodeBuiltIn(deps)
        const r = await h({ command: 'node', args: { sub: 'show' }, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/usage/)
    })

    it('unknown subcommand fails clearly', async () => {
        const h = makeNodeBuiltIn(deps)
        const r = await h({ command: 'node', args: { sub: 'frobnicate' }, userId: 'u', uiHandle: null })
        expect(r.success).toBe(false)
        expect(r.markup.text).toMatch(/unknown subcommand/)
    })

    it('deregister marks the node DISABLED and detaches from aggregator', async () => {
        const { nodeId } = await deps.registry.provision({
            nodeName: 'd', certFingerprint: 'w', createdVia: 'cli', autoActivate: true,
        })
        deps.aggregator.attach({
            nodeId, nodeName: 'd', version: '1.0.0',
            commands: [{ name: 'cmd-d', compatibilityId: 'cid-d', version: '1.0.0', description: '', args: [], aliases: [] }],
            services: [], configs: [], hardware: {}, metrics: {},
        })
        const h = makeNodeBuiltIn(deps)
        await h({ command: 'node', args: { sub: 'deregister', id: nodeId }, userId: 'u', uiHandle: null })
        expect((await deps.registry.get(nodeId))!.state).toBe('DISABLED')
        expect(deps.aggregator.getManifest(nodeId)).toBeUndefined()
    })
})
