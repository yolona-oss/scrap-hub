import { ManifestAggregator, AggregatedManifest } from '../manifest-aggregator'
import { argBranch } from '@cmd-hub/common'

const mf = (
    nodeId: string,
    name: string,
    cid: string,
    v: string,
    configs: AggregatedManifest['configs'] = [],
): AggregatedManifest => ({
    nodeId, nodeName: nodeId, version: '1.0.0',
    commands: [{ name, compatibilityId: cid, version: v, description: '', args: argBranch({}), aliases: [] }],
    services: [],
    configs,
    hardware: {},
    metrics: {},
})

describe('ManifestAggregator', () => {
    it('attach + listCommandNames reflect aggregated view', () => {
        const a = new ManifestAggregator()
        expect(a.attach(mf('A', 'scraper', 'cid', '1.0.0')).ok).toBe(true)
        expect(a.attach(mf('B', 'scraper', 'cid', '1.1.0')).ok).toBe(true)
        expect(a.listCommandNames()).toEqual(['scraper'])
        expect(a.getPool().members('scraper').map((m) => m.nodeId).sort()).toEqual(['A', 'B'])
    })

    it('rejects an incompatible manifest without partial registration', () => {
        const a = new ManifestAggregator()
        a.attach(mf('A', 'scraper', 'cid', '1.0.0'))
        const r = a.attach(mf('B', 'scraper', 'other', '1.0.0'))
        expect(r.ok).toBe(false)
        expect(a.getPool().members('scraper').map((m) => m.nodeId)).toEqual(['A'])
        expect(a.getManifest('B')).toBeUndefined()
    })

    it('rejects a second attach with the same nodeId', () => {
        const a = new ManifestAggregator()
        a.attach(mf('A', 'scraper', 'cid', '1.0.0'))
        const r = a.attach(mf('A', 'scraper2', 'cid2', '1.0.0'))
        expect(r.ok).toBe(false)
    })

    it('detach removes all of a node\'s contributions', () => {
        const a = new ManifestAggregator()
        a.attach(mf('A', 'scraper', 'cid', '1.0.0'))
        a.detach('A')
        expect(a.listCommandNames()).toEqual([])
        expect(a.getManifest('A')).toBeUndefined()
    })

    it('indexes configModuleOwners across nodes and prunes on detach', () => {
        const a = new ManifestAggregator()
        a.attach(mf('A', 'scraper', 'cid', '1.0.0', [
            { name: 'scraper', scope: 'system', fields: [] },
        ]))
        a.attach(mf('B', 'other', 'cid2', '1.0.0', [
            { name: 'scraper', scope: 'system', fields: [] },
            { name: 'other',   scope: 'user',   fields: [] },
        ]))
        expect(a.configModuleOwners('scraper').sort()).toEqual(['A', 'B'])
        expect(a.configModuleOwners('other')).toEqual(['B'])
        expect(a.configModuleNames()).toEqual(['other', 'scraper'])

        a.detach('B')
        expect(a.configModuleOwners('scraper')).toEqual(['A'])
        expect(a.configModuleOwners('other')).toEqual([])
        expect(a.configModuleNames()).toEqual(['scraper'])
    })
})
