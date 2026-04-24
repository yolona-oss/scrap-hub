import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import request from 'supertest'
import { z } from 'zod'
import { MongoMiddleware, Application } from '@cmd-hub/common'
import { NodeRecordModel, FileMetadataModel, type FileService } from '@cmd-hub/transport'
import { GrpcServerMiddleware } from '../grpc-server-middleware'
import { UploadEndpointMiddleware } from '../upload-endpoint-middleware'

class TestApp extends Application<any> {
    async run(): Promise<void> {}
}

describe('UploadEndpointMiddleware', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('upload-mw-test'))
        await NodeRecordModel.init()
        await FileMetadataModel.init()
        await mongoose.disconnect()
    }, 120_000)
    afterAll(async () => {
        await rs.stop()
    })

    it('accepts a PUT upload against a write grant', async () => {
        const app = new TestApp({
            configPath: '',
            baseSchema: z.object({}),
            inlineConfig: {
                mongo: { url: rs.getUri('upload-mw-test'), migrateConfigRegistry: false },
                grpc: { bindAddress: '127.0.0.1:0', publicBaseUrl: 'http://127.0.0.1:0' },
                upload: { bindAddress: '127.0.0.1:0' },
            } as any,
            name: 'upload-mw-test-app',
        })
            .use(new MongoMiddleware())
            .use(new GrpcServerMiddleware({ insecure: true }))
            .use(new UploadEndpointMiddleware())

        await app.Initialize()

        const boundAddress = (app as any)._uploadBoundAddress as string
        const fileService = (app as any)._fileService as FileService

        const grant = await fileService.issueWriteGrant({
            sessionId: 'test-session',
            nodeId: 'node-1',
            name: 'hello.txt',
            mime: 'text/plain',
            ttlSeconds: 60,
            permanent: false,
            maxBytes: 1024,
        })

        const body = Buffer.from('hello world', 'utf8')
        const res = await request(`http://${boundAddress}`)
            .put('/upload')
            .query({ grant: grant.grantId })
            .set('Authorization', `Bearer ${grant.token}`)
            .set('Content-Type', 'application/octet-stream')
            .send(body)

        expect(res.status).toBe(201)
        expect(res.body.handle).toBeDefined()

        await app.terminate()
    }, 60_000)
})
