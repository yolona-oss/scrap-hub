import {
    ManifestAggregator,
    AggregatedManifest,
    UIRequirementsForFiltering,
} from '../manifest-aggregator'

/** Build a manifest with the Phase C fields (requires per-command +
 *  node-level publishedCapabilities). Defaults to no requirements. */
function mf(opts: {
    nodeId: string
    commands: Array<{
        name: string
        compatibilityId: string
        version?: string
        requires?: string[]
    }>
    publishedCapabilities?: string[]
}): AggregatedManifest {
    return {
        nodeId: opts.nodeId,
        nodeName: opts.nodeId,
        version: '1.0.0',
        commands: opts.commands.map(c => ({
            name: c.name,
            compatibilityId: c.compatibilityId,
            version: c.version ?? '1.0.0',
            description: '',
            args: [],
            aliases: [],
            requires: c.requires ?? [],
        })),
        services: [],
        configs: [],
        hardware: {},
        metrics: {},
        publishedCapabilities: opts.publishedCapabilities ?? [],
    }
}

const ui = (uiName: string, essential: string[], supported: string[] = []): UIRequirementsForFiltering => ({
    uiName, essential, supported,
})

describe('ManifestAggregator + UI federationRequires (Phase C)', () => {
    it('with no UI requirements, every node is eligible (legacy behaviour)', () => {
        const a = new ManifestAggregator()
        const r = a.attach(mf({
            nodeId: 'A',
            commands: [{ name: 'scraper', compatibilityId: 'cid' }],
        }))
        expect(r.ok).toBe(true)
        const member = a.getPool().pick('scraper')
        expect(member?.nodeId).toBe('A')
        expect(member?.eligibleUIs).toBeUndefined()
    })

    it('drops a command from a UI pool when an essential cap is missing', () => {
        const a = new ManifestAggregator()
        a.setUIRequirements([ui('telegram', ['cap.db'])])

        const r = a.attach(mf({
            nodeId: 'A',
            commands: [{ name: 'scraper', compatibilityId: 'cid' }],
            publishedCapabilities: [],  // no cap.db
        }))
        expect(r.ok).toBe(true)
        if (!r.ok) throw new Error('expected ok')
        expect(r.warnings).toHaveLength(1)
        expect(r.warnings[0].severity).toBe('rejected')
        expect(r.warnings[0].uiName).toBe('telegram')
        expect(r.warnings[0].missingCaps).toEqual(['cap.db'])

        // Pool still has the member (other UIs may pick it), but it's not
        // eligible for telegram.
        expect(a.getPool().pick('scraper', { uiName: 'telegram' })).toBeNull()
        // No other UI configured — picking with no UI hint still works.
        expect(a.getPool().pick('scraper')?.nodeId).toBe('A')
    })

    it('keeps a command across UIs but warns when a supported cap is missing', () => {
        const a = new ManifestAggregator()
        a.setUIRequirements([ui('telegram', ['cap.db'], ['cap.analytics'])])

        const r = a.attach(mf({
            nodeId: 'A',
            commands: [{ name: 'scraper', compatibilityId: 'cid' }],
            publishedCapabilities: ['cap.db'],
        }))
        expect(r.ok).toBe(true)
        if (!r.ok) throw new Error('expected ok')
        expect(r.warnings).toHaveLength(1)
        expect(r.warnings[0].severity).toBe('warned')
        expect(r.warnings[0].missingCaps).toEqual(['cap.analytics'])

        // Still eligible for telegram (warning is non-blocking).
        expect(a.getPool().pick('scraper', { uiName: 'telegram' })?.nodeId).toBe('A')
    })

    it('per-UI eligibility: a node may serve UI X but not UI Y', () => {
        const a = new ManifestAggregator()
        a.setUIRequirements([
            ui('telegram', ['cap.db']),
            ui('web', ['cap.web-only']),
        ])

        a.attach(mf({
            nodeId: 'A',
            commands: [{ name: 'scraper', compatibilityId: 'cid' }],
            publishedCapabilities: ['cap.db'],  // satisfies telegram, not web
        }))

        expect(a.getPool().pick('scraper', { uiName: 'telegram' })?.nodeId).toBe('A')
        expect(a.getPool().pick('scraper', { uiName: 'web' })).toBeNull()
    })

    it('aggregates warnings across multiple attaches', () => {
        const a = new ManifestAggregator()
        a.setUIRequirements([ui('telegram', ['cap.db'])])
        a.attach(mf({
            nodeId: 'A',
            commands: [{ name: 'scraper', compatibilityId: 'cid' }],
            publishedCapabilities: [],
        }))
        a.attach(mf({
            nodeId: 'B',
            commands: [{ name: 'scraper', compatibilityId: 'cid' }],
            publishedCapabilities: ['cap.db'],
        }))
        const all = a.listWarnings()
        expect(all).toHaveLength(1)
        expect(all[0].nodeId).toBe('A')
        expect(all[0].severity).toBe('rejected')
    })

    it('uiRequirements override is honoured over registered defaults', () => {
        const a = new ManifestAggregator()
        a.setUIRequirements([ui('telegram', ['cap.x'])])
        // Override at attach time — registered telegram requirement is bypassed.
        const r = a.attach(
            mf({
                nodeId: 'A',
                commands: [{ name: 'scraper', compatibilityId: 'cid' }],
                publishedCapabilities: [],
            }),
            [ui('cli', ['cap.y'])],
        )
        expect(r.ok).toBe(true)
        if (!r.ok) throw new Error('expected ok')
        expect(r.warnings.every(w => w.uiName === 'cli')).toBe(true)
    })

    it('round-robin within the eligible subset when multiple nodes match a UI', () => {
        const a = new ManifestAggregator()
        a.setUIRequirements([ui('telegram', ['cap.db'])])
        a.attach(mf({ nodeId: 'A', commands: [{ name: 'scraper', compatibilityId: 'cid' }], publishedCapabilities: ['cap.db'] }))
        a.attach(mf({ nodeId: 'B', commands: [{ name: 'scraper', compatibilityId: 'cid' }], publishedCapabilities: [] }))
        a.attach(mf({ nodeId: 'C', commands: [{ name: 'scraper', compatibilityId: 'cid' }], publishedCapabilities: ['cap.db'] }))

        // For telegram: only A and C are eligible. Round-robin alternates A → C → A.
        const picks: string[] = []
        for (let i = 0; i < 4; i++) {
            picks.push(a.getPool().pick('scraper', { uiName: 'telegram' })!.nodeId)
        }
        // Expect A and C both picked, B never picked.
        expect(picks).not.toContain('B')
        expect(new Set(picks)).toEqual(new Set(['A', 'C']))
    })
})
