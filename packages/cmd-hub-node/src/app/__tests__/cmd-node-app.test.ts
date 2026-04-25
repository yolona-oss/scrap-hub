import 'reflect-metadata'
import { EventEmitter } from 'events'
import { z } from 'zod'
import { CmdArgument, CmdService } from '@cmd-hub/common'
import { CmdNodeApp } from '../cmd-node-app'

class Cfg {
    @CmdArgument({ required: true, position: 1, description: 'Query' })
    query!: string
}
class Par {}
class Msg {}

@CmdService({
    name: 'scraper',
    description: 'Scrape things',
    compatibilityId: 'com.example.scraper',
    version: '1.0.0',
    config: Cfg, params: Par, messages: Msg,
})
class ScraperService extends EventEmitter {
    static configNamespace = 'scraper'
    static configSchema = z.object({ apiKey: z.string() })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(_userId: string, _defaultData: unknown, _input: unknown) {
        super()
    }
    async receiveMsg(_id: string, _args: string[]): Promise<void> {}
    async run(): Promise<void> { this.emit('done') }
}

class UndecoratedService extends EventEmitter {
    async receiveMsg(_id: string, _args: string[]): Promise<void> {}
    async run(): Promise<void> {}
}

function mkApp() {
    return new CmdNodeApp({
        configPath: '',
        nodeId: 'n-1',
        nodeName: 'node-1',
        version: '0.0.1',
        inlineConfig: { scraper: { apiKey: 'k' } } as any,
        name: `cmd-node-app-test-${Math.random().toString(36).slice(2)}`,
    })
}

describe('CmdNodeApp', () => {
    it('useCommand rejects undecorated classes and duplicate names', async () => {
        const app = mkApp()
        expect(() => app.useCommand(UndecoratedService as any))
            .toThrow(/@CmdService/)

        app.useCommand(ScraperService as any)
        expect(() => app.useCommand(ScraperService as any))
            .toThrow(/duplicate command name/)
    })

    it('buildManifest returns a NodeManifest with the registered commands', async () => {
        const app = mkApp().useCommand(ScraperService as any)
        const manifest = await app.buildManifest()
        expect(manifest.nodeId).toBe('n-1')
        expect(manifest.nodeName).toBe('node-1')
        expect(manifest.version).toBe('0.0.1')
        expect(manifest.commands).toHaveLength(1)
        expect(manifest.commands[0].name).toBe('scraper')
        expect(manifest.commands[0].compatibilityId).toBe('com.example.scraper')
        expect(manifest.commands[0].version).toBe('1.0.0')
        // Hardware is captured fresh.
        expect(manifest.hardware?.cpuCores).toBeGreaterThan(0)
    })

    it('useCommands registers many at once', async () => {
        @CmdService({
            name: 'other',
            description: 'x',
            compatibilityId: 'com.example.other',
            version: '1.0.0',
            config: Cfg, params: Par, messages: Msg,
        })
        class OtherService extends EventEmitter {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            constructor(_u: string, _d: unknown, _i: unknown) { super() }
            async receiveMsg(_id: string, _args: string[]): Promise<void> {}
            async run(): Promise<void> {}
        }
        const app = mkApp().useCommands([ScraperService as any, OtherService as any])
        const manifest = await app.buildManifest()
        const names = manifest.commands.map((c) => c.name).sort()
        expect(names).toEqual(['other', 'scraper'])
    })

    it('_collectSubclassContributors surfaces static configNamespace+configSchema', async () => {
        const app = mkApp().useCommand(ScraperService as any)
        // Access the protected method through a cast for this test.
        const contributors = (app as any)._collectSubclassContributors() as Array<{ namespace: string; schema: unknown }>
        expect(contributors).toHaveLength(1)
        expect(contributors[0].namespace).toBe('scraper')
        expect(contributors[0].schema).toBe(ScraperService.configSchema)
    })
})
