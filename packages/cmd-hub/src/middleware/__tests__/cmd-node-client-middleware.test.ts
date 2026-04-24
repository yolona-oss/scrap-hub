import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { z } from 'zod'
import { MongoMiddleware, Application } from '@cmd-hub/common'
import { NodeRecordModel, type ICmdNodeClient } from '@cmd-hub/transport'
import { GrpcServerMiddleware } from '../grpc-server-middleware'
import { CmdNodeClientMiddleware } from '../cmd-node-client-middleware'

class TestApp extends Application<any> {
    async run(): Promise<void> {}
}

describe('CmdNodeClientMiddleware', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('cnc-mw-test'))
        await NodeRecordModel.init()
        await mongoose.disconnect()
    }, 120_000)
    afterAll(async () => {
        await rs.stop()
    })

    it('publishes _cmdNodeClient on the app after install', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: {
                mongo: { url: rs.getUri('cnc-mw-test'), migrateConfigRegistry: false },
                grpc: { bindAddress: '127.0.0.1:0', publicBaseUrl: 'http://127.0.0.1:0' },
            } as any,
            name: 'cnc-mw-test-app',
        })
            .use(new MongoMiddleware())
            .use(new GrpcServerMiddleware({ insecure: true }))
            .use(new CmdNodeClientMiddleware())

        await app.Initialize()

        const client = (app as any)._cmdNodeClient as ICmdNodeClient | null
        expect(client).not.toBeNull()
        expect(typeof client!.invoke).toBe('function')

        await app.terminate()
        expect((app as any)._cmdNodeClient).toBeNull()
    }, 60_000)
})
