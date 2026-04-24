import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { MongoMiddleware } from '../mongo-middleware'
import { Application } from '../../application/application'
import { z } from 'zod'

class TestApp extends Application<{ mongo: { url: string; migrateConfigRegistry: boolean } }> {
    async run(): Promise<void> {}
}

describe('MongoMiddleware', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
    }, 120_000)
    afterAll(async () => { await rs.stop() })

    it('connects mongoose on install and disconnects on uninstall', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: { mongo: { url: rs.getUri('mw-test'), migrateConfigRegistry: false } },
        }).use(new MongoMiddleware())
        await app.Initialize()
        expect(mongoose.connection.readyState).toBe(1)  // connected
        await app.terminate()
        expect(mongoose.connection.readyState).toBe(0)  // disconnected
    }, 60_000)
})
