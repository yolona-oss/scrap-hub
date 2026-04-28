import 'reflect-metadata'
import { CmdNodeApp } from '@cmd-hub/node'
import { z } from 'zod'
import { OrgScraperService, SCRAPER_NAME } from '../service'

/**
 * The manifest the node publishes to the hub must carry the scraper
 * service's option tree — config + params + messages — encoded as a
 * `CommandOptionsTree` proto. This guards against regressions in:
 *   - `treeToProto` silently dropping nested branch classes
 *     (`AIAgentSettings`, `GoogleSheetsSettings`)
 *   - leaf typing (`limit` as 'number', `pause` as 'bool', etc.)
 *   - leaf defaults (`format='csv'`, `aiAgent.model='qwen2.5:7b'`, ...)
 */
describe('OrgScraperService manifest emits a tree', () => {
    function buildManifest() {
        const app = new CmdNodeApp({
            configPath: '',
            inlineConfig: {
                hub: { nodeId: 'test', nodeName: 'test', version: '1.0.0' },
            } as any,
            baseSchema: z.object({}).passthrough(),
            nodeId: 'test',
            nodeName: 'test',
            version: '1.0.0',
            name: `manifest-smoke-${Math.random().toString(36).slice(2)}`,
        })
        app.useCommand(OrgScraperService)
        return app.buildManifest()
    }

    test('root carries config / params / messages slices', async () => {
        const manifest = await buildManifest()
        const cmd = manifest.commands.find(c => c.name === SCRAPER_NAME)
        expect(cmd?.options?.branch).toBeDefined()
        const children = cmd!.options!.branch!.children
        expect(Object.keys(children).sort()).toEqual(['config', 'messages', 'params'])
    })

    test('nested aiAgent branch survives treeToProto with typed leaves', async () => {
        const manifest = await buildManifest()
        const config = manifest.commands.find(c => c.name === SCRAPER_NAME)!
            .options!.branch!.children.config.branch!.children

        expect(config.aiAgent.branch).toBeDefined()
        const ai = config.aiAgent.branch!.children

        expect(ai.model.leaf!.type).toBe('string')
        expect(ai.model.leaf!.default).toBe('qwen2.5:7b')
        expect(ai.model.leaf!.options).toContain('qwen2.5:7b')

        expect(ai.temperature.leaf!.type).toBe('number')
        expect(ai.temperature.leaf!.default).toBe('0.2')

        expect(ai.maxToolCalls.leaf!.type).toBe('number')
        expect(ai.totalTimeoutMs.leaf!.type).toBe('number')
    })

    test('config.query is the required positional leaf', async () => {
        const manifest = await buildManifest()
        const config = manifest.commands.find(c => c.name === SCRAPER_NAME)!
            .options!.branch!.children.config.branch!.children

        expect(config.query.leaf!.required).toBe(true)
        expect(config.query.leaf!.position).toBe(1)
    })

    test('typed numeric leaves on the config root carry defaults', async () => {
        const manifest = await buildManifest()
        const config = manifest.commands.find(c => c.name === SCRAPER_NAME)!
            .options!.branch!.children.config.branch!.children

        expect(config.limit.leaf!.type).toBe('number')
        expect(config.limit.leaf!.default).toBe('10000')

        expect(config.requestDelayMs.leaf!.type).toBe('number')
        expect(config.requestDelayMs.leaf!.default).toBe('1000')

        expect(config.format.leaf!.default).toBe('json')
        // CSV + google-sheets stay in the picker (their plugins are
        // registered by default in index.ts) but JSON is the baseline.
        expect(config.format.leaf!.options).toEqual(
            expect.arrayContaining(['json', 'csv', 'google-sheets']),
        )
    })

    test('messages slice exposes pause/resume/stop/export as standalone bool leaves', async () => {
        const manifest = await buildManifest()
        const msg = manifest.commands.find(c => c.name === SCRAPER_NAME)!
            .options!.branch!.children.messages.branch!.children

        for (const name of ['pause', 'resume', 'stop', 'export'] as const) {
            expect(msg[name].leaf?.standalone).toBe(true)
            expect(msg[name].leaf?.type).toBe('bool')
        }
    })
})
