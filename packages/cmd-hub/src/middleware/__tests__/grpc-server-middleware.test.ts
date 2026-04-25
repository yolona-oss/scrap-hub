import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import * as grpc from '@grpc/grpc-js'
import { z } from 'zod'
import { Application } from '@cmd-hub/common'
import { CmdHubProto, CAP_GrpcBoundAddress } from '@cmd-hub/transport'
import {
    MongoStorageMiddleware,
    GridFsStorageMiddleware,
    NodeRecordModel,
} from '@cmd-hub/storage-mongo'
import { GrpcServerMiddleware } from '../grpc-server-middleware'

class TestApp extends Application<any> {
    async run(): Promise<void> {}
}

describe('GrpcServerMiddleware', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('grpc-mw-test'))
        await NodeRecordModel.init()
        await mongoose.disconnect()
    }, 120_000)
    afterAll(async () => {
        await rs.stop()
    })

    it('starts a listening gRPC server and accepts connections', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: {
                storage: { url: rs.getUri('grpc-mw-test') },
                gridfs: { publicBaseUrl: 'http://127.0.0.1:0', bindAddress: '127.0.0.1:0' },
                grpc: { bindAddress: '127.0.0.1:0' },
            },
            name: 'grpc-mw-test-app',
        })
            .use(new MongoStorageMiddleware())
            .use(new GridFsStorageMiddleware())
            .use(new GrpcServerMiddleware({ insecure: true }))

        await app.Initialize()
        const boundAddress = app.get(CAP_GrpcBoundAddress)!
        expect(boundAddress).toMatch(/:\d+$/)

        // Verify a client can at least connect.
        const client = new CmdHubProto.CmdHubServiceClient(
            boundAddress,
            grpc.credentials.createInsecure(),
        )
        client.close()

        await app.terminate()
    }, 60_000)
})
