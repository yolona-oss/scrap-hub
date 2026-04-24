import { MongoMemoryReplSet } from 'mongodb-memory-server'
import { z } from 'zod'
import { CmdHubApp } from '../cmd-hub-app'
import { MongoMiddleware, type ConfigContributor, type IUI } from '@cmd-hub/common'

class FakeUI implements IUI<any>, ConfigContributor {
    readonly dispatcher: unknown = null
    readonly namespace = 'fakeui'
    readonly schema = z.object({ enabled: z.boolean().default(true) })

    attached = false
    running = false

    async onAppAttach(_app: unknown): Promise<void> { this.attached = true }
    async run(): Promise<void> { this.running = true }
    async terminate(): Promise<void> { this.running = false }

    isRunning(): boolean { return this.running }
    isInitialized(): boolean { return true }

    async sendMessage(): Promise<string> { return '1' }
    async editMessage(): Promise<void> {}
    async deleteMessage(): Promise<void> {}
    max_message_width(): number { return 60 }
    ContextType(): any { return 'fake' }
    consolePrintCommands(): void {}
    lock(): boolean { return true }
    unlock(): boolean { return true }
}

describe('CmdHubApp', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => { rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } }) }, 120_000)
    afterAll(async () => { await rs.stop() })

    it('calls onAppAttach + run on registered UIs during run()', async () => {
        const ui = new FakeUI()
        const app = new CmdHubApp<any>({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: {
                mongo: { url: rs.getUri('cmdhub-app-test'), migrateConfigRegistry: false },
                fakeui: { enabled: true },
            } as any,
            name: 'cmdhub-app-test',
        }).use(new MongoMiddleware()).useUI(ui)

        await app.Initialize()
        await app.run()
        expect(ui.attached).toBe(true)
        expect(ui.running).toBe(true)

        await app.terminate()
        expect(ui.running).toBe(false)
    }, 60_000)
})
