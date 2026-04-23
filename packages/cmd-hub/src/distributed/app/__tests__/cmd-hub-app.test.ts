import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { CmdHubApp, IHubUIPlugin } from '../cmd-hub-app'

describe('CmdHubApp', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    }, 120_000)
    afterAll(async () => { await rs.stop() })

    it('composes deps, is idempotent on start/stop, and drives UI lifecycle', async () => {
        const app = new CmdHubApp({
            mongoUrl: rs.getUri('cmdhub-app'),
            hubPublicBaseUrl: 'http://hub.test',
            autoRegister: true,
        })
        const uiStart = jest.fn().mockResolvedValue(undefined)
        const uiStop  = jest.fn().mockResolvedValue(undefined)
        const ui: IHubUIPlugin = { start: uiStart, stop: uiStop }

        app.useUI(ui)
        await app.start()
        await app.start() // idempotent
        expect(uiStart).toHaveBeenCalledTimes(1)

        await app.stop()
        await app.stop() // idempotent
        expect(uiStop).toHaveBeenCalledTimes(1)
    })

    it('registers built-in commands on start', async () => {
        const app = new CmdHubApp({
            mongoUrl: rs.getUri('cmdhub-app-2'),
            hubPublicBaseUrl: 'http://hub.test',
            autoRegister: true,
        })
        await app.start()
        expect(app.dispatcherInstance.builtInNames().sort()).toEqual(
            ['config', 'help', 'node', 'sconfig', 'service-ctrl'],
        )
        await app.stop()
    })

    it('/help built-in runs locally through the dispatcher', async () => {
        const app = new CmdHubApp({
            mongoUrl: rs.getUri('cmdhub-app-3'),
            hubPublicBaseUrl: 'http://hub.test',
            autoRegister: true,
        })
        await app.start()
        const r = await app.dispatcherInstance.handle({
            command: 'help', args: {}, userId: 'u', uiHandle: null,
        })
        expect(r.success).toBe(true)
        expect(r.markup.text).toContain('/help')
        expect(r.markup.text).toContain('/node')
        await app.stop()
    })
})
