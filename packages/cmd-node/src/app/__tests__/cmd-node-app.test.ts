import { CmdNodeApp } from '../cmd-node-app'

const validCmd = {
    name: 'echo',
    compatibilityId: 'com.example.echo',
    version: '1.0.0',
    description: 'echoes',
    args: [],
    aliases: [],
}

describe('CmdNodeApp', () => {
    it('requires nodeId, nodeName, and version at construction', () => {
        expect(() => new CmdNodeApp({ nodeId: '', nodeName: 'n', version: '1.0.0' })).toThrow(/nodeId/)
        expect(() => new CmdNodeApp({ nodeId: 'n', nodeName: '', version: '1.0.0' })).toThrow(/nodeName/)
        expect(() => new CmdNodeApp({ nodeId: 'n', nodeName: 'n', version: '' })).toThrow(/version/)
    })

    it('refuses to register a command without compatibility_id, version, or semver shape', () => {
        const app = new CmdNodeApp({ nodeId: 'n', nodeName: 'n', version: '1.0.0' })
        expect(() => app.useCommand({ ...validCmd, compatibilityId: '' })).toThrow(/compatibility_id/)
        expect(() => app.useCommand({ ...validCmd, version: '' })).toThrow(/version is required/)
        expect(() => app.useCommand({ ...validCmd, version: 'banana' })).toThrow(/semver-shaped/)
    })

    it('builds a manifest including registered commands, services, configs, and hardware', () => {
        const app = new CmdNodeApp({ nodeId: 'n1', nodeName: 'node-1', version: '2.3.1' })
        app.useCommand(validCmd)
        app.useService({
            command: { ...validCmd, name: 'scraper', compatibilityId: 'com.ex.scraper' },
            intercomActions: [{ id: 'export', label: 'Export', icon: '' }],
            caps: { supportsPause: true, supportsStop: true },
            serviceClass: class {},
        })
        app.useConfigModule({
            name: 'scraper',
            scope: 'system',
            fields: [{ name: 'apiKey', type: 'string', sensitive: true, description: 'key', defaultValue: '' }],
        })

        const m = app.buildManifest()
        expect(m.nodeId).toBe('n1')
        expect(m.nodeName).toBe('node-1')
        expect(m.version).toBe('2.3.1')
        expect(m.commands.map((c) => c.name)).toEqual(['echo'])
        expect(m.services.map((s) => s.command?.name)).toEqual(['scraper'])
        expect(m.configs.map((c) => c.name)).toEqual(['scraper'])
        expect(m.hardware?.cpuCores).toBeGreaterThan(0)
        expect(m.hardware?.hostname.length).toBeGreaterThan(0)
    })

    it('start/stop flip isStarted and are idempotent', async () => {
        const app = new CmdNodeApp({ nodeId: 'n', nodeName: 'n', version: '1.0.0' })
        expect(app.isStarted()).toBe(false)
        await app.start()
        await app.start()
        expect(app.isStarted()).toBe(true)
        await app.stop()
        await app.stop()
        expect(app.isStarted()).toBe(false)
    })
})
