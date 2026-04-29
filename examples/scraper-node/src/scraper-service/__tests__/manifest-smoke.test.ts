import 'reflect-metadata'
import { CmdNodeApp } from '@cmd-hub/node'
import { z } from 'zod'
import { OrgScraperService, SCRAPER_NAME } from '../service'

/**
 * The manifest the node publishes to the hub must carry the scraper
 * service's arg tree — args + intercom — encoded as a
 * `CommandArgTree` proto. This guards against regressions in:
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

    test('root carries args / intercom slices', async () => {
        const manifest = await buildManifest()
        const cmd = manifest.commands.find(c => c.name === SCRAPER_NAME)
        expect(cmd?.args?.branch).toBeDefined()
        const children = cmd!.args!.branch!.children
        expect(Object.keys(children).sort()).toEqual(['args', 'intercom'])
    })

    test('nested aiAgent branch survives treeToProto with typed leaves', async () => {
        const manifest = await buildManifest()
        const args = manifest.commands.find(c => c.name === SCRAPER_NAME)!
            .args!.branch!.children.args.branch!.children

        expect(args.aiAgent.branch).toBeDefined()
        const ai = args.aiAgent.branch!.children

        expect(ai.model.leaf!.type).toBe('string')
        expect(ai.model.leaf!.default).toBe('qwen2.5:7b')
        expect(ai.model.leaf!.choices).toContain('qwen2.5:7b')

        expect(ai.temperature.leaf!.type).toBe('number')
        expect(ai.temperature.leaf!.default).toBe('0.2')

        expect(ai.maxToolCalls.leaf!.type).toBe('number')
        expect(ai.totalTimeoutMs.leaf!.type).toBe('number')
    })

    test('args.query is the required positional leaf', async () => {
        const manifest = await buildManifest()
        const args = manifest.commands.find(c => c.name === SCRAPER_NAME)!
            .args!.branch!.children.args.branch!.children

        expect(args.query.leaf!.required).toBe(true)
        expect(args.query.leaf!.position).toBe(1)
    })

    test('typed numeric leaves on the args root carry defaults', async () => {
        const manifest = await buildManifest()
        const args = manifest.commands.find(c => c.name === SCRAPER_NAME)!
            .args!.branch!.children.args.branch!.children

        expect(args.limit.leaf!.type).toBe('number')
        expect(args.limit.leaf!.default).toBe('10000')

        expect(args.requestDelayMs.leaf!.type).toBe('number')
        expect(args.requestDelayMs.leaf!.default).toBe('1000')

        expect(args.format.leaf!.default).toBe('json')
        // CSV + google-sheets stay in the picker (their plugins are
        // registered by default in index.ts) but JSON is the baseline.
        expect(args.format.leaf!.choices).toEqual(
            expect.arrayContaining(['json', 'csv', 'google-sheets']),
        )
    })

    test('intercom slice exposes pause/resume/stop/export as standalone bool leaves', async () => {
        const manifest = await buildManifest()
        const intercom = manifest.commands.find(c => c.name === SCRAPER_NAME)!
            .args!.branch!.children.intercom.branch!.children

        for (const name of ['pause', 'resume', 'stop', 'export'] as const) {
            expect(intercom[name].leaf?.standalone).toBe(true)
            expect(intercom[name].leaf?.type).toBe('bool')
        }
    })
})
