import express from 'express'
import request from 'supertest'
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { GridFSBackend } from '../gridfs-backend'
import { FileService } from '../file-service'
import { makeUploadEndpoint } from '../upload-endpoint'

describe('upload endpoint (PUT /upload)', () => {
    let rs: MongoMemoryReplSet
    let app: express.Express
    let backend: GridFSBackend
    let fileService: FileService

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('upload-test'))
        backend = new GridFSBackend({
            conn: mongoose.connection,
            hubPublicBaseUrl: 'http://hub.test',
        })
        fileService = new FileService(backend)
        app = express()
        app.use(makeUploadEndpoint({
            fileService,
            grantAccess: { peek: (id) => backend.peekGrant(id) },
            conn: mongoose.connection,
        }))
    }, 180_000)

    afterAll(async () => {
        await mongoose.disconnect()
        await rs.stop()
    })

    it('accepts bytes with a valid grant and matching token', async () => {
        const grant = await backend.issueWriteGrant({
            sessionId: 's', nodeId: 'n', name: 'r.csv', mime: 'text/csv',
            ttlSeconds: 3600, permanent: false, maxBytes: 1_000,
        })
        const body = 'name,phone\nA,1\n'
        const res = await request(app)
            .put(`/upload?grant=${grant.grantId}`)
            .set('Authorization', `Bearer ${grant.token}`)
            .set('Content-Type', 'application/octet-stream')
            .send(body)
        expect(res.status).toBe(201)
        expect(res.body.handle.size).toBe(body.length)
        expect(res.body.handle.backend).toBe('gridfs')

        // Round-trip: fetch bytes back via the FileService.
        const chunks: Buffer[] = []
        for await (const c of fileService.read(res.body.handle)) chunks.push(c)
        expect(Buffer.concat(chunks).toString()).toBe(body)
    })

    it('returns 401 when the bearer token does not match', async () => {
        const grant = await backend.issueWriteGrant({
            sessionId: null, nodeId: null, name: 'x', mime: 'text/plain',
            ttlSeconds: 3600, permanent: false, maxBytes: 1_000,
        })
        const res = await request(app)
            .put(`/upload?grant=${grant.grantId}`)
            .set('Authorization', 'Bearer wrong')
            .send('hello')
        expect(res.status).toBe(401)
    })

    it('returns 404 when the grant id does not exist', async () => {
        const res = await request(app)
            .put('/upload?grant=not-a-real-grant')
            .set('Authorization', 'Bearer whatever')
            .send('hello')
        expect(res.status).toBe(404)
    })

    it('returns 400 when the grant query param is missing', async () => {
        const res = await request(app).put('/upload').send('hi')
        expect(res.status).toBe(400)
    })

    it('returns 413 when body exceeds maxBytes', async () => {
        const grant = await backend.issueWriteGrant({
            sessionId: null, nodeId: null, name: 'big', mime: 'text/plain',
            ttlSeconds: 3600, permanent: false, maxBytes: 10,
        })
        const res = await request(app)
            .put(`/upload?grant=${grant.grantId}`)
            .set('Authorization', `Bearer ${grant.token}`)
            .set('Content-Type', 'application/octet-stream')
            .send('this is more than ten bytes')
        expect(res.status).toBe(413)
    })
})
