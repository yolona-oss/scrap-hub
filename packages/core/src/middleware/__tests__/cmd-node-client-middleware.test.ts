import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { z } from 'zod'
import { Application } from '@cmd-hub/common'
import { CAP_CmdNodeClient } from '@cmd-hub/transport'
import {
    MongoStorageMiddleware,
    GridFsStorageMiddleware,
    NodeRecordModel,
} from '@cmd-hub/storage-mongo'
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

    it('publishes CAP_CmdNodeClient on the app after install', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: {
                storage: { url: rs.getUri('cnc-mw-test') },
                gridfs: { publicBaseUrl: 'http://127.0.0.1:0', bindAddress: '127.0.0.1:0' },
                grpc: { bindAddress: '127.0.0.1:0' },
            },
            name: 'cnc-mw-test-app',
        })
            .use(new MongoStorageMiddleware())
            .use(new GridFsStorageMiddleware())
            .use(new GrpcServerMiddleware({ insecure: true }))
            .use(new CmdNodeClientMiddleware())

        await app.Initialize()

        const client = app.get(CAP_CmdNodeClient)
        expect(client).toBeDefined()
        expect(typeof client!.invoke).toBe('function')

        await app.terminate()
        expect(app.get(CAP_CmdNodeClient)).toBeUndefined()
    }, 60_000)
})
