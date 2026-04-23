import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { GridFSBackend } from '../gridfs-backend'

describe('GridFSBackend', () => {
    let rs: MongoMemoryReplSet
    let backend: GridFSBackend

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('gfs-test'))
        backend = new GridFSBackend({
            conn: mongoose.connection,
            hubPublicBaseUrl: 'http://hub.test',
        })
    }, 120_000)

    afterAll(async () => {
        await mongoose.disconnect()
        await rs.stop()
    })

    it('issues a grant, accepts bytes, returns a FileHandle, and reads back', async () => {
        const grant = await backend.issueWriteGrant({
            sessionId: 's1', nodeId: 'n1', name: 'r.csv',
            mime: 'text/csv', ttlSeconds: 3600, permanent: false, maxBytes: 1_000_000,
        })
        expect(grant.uploadUrl).toContain('http://hub.test')
        expect(grant.prospective.permanent).toBe(false)

        const db = mongoose.connection.db
        if (!db) throw new Error('no mongoose db')
        const bucket = new mongoose.mongo.GridFSBucket(db)
        const stream = bucket.openUploadStreamWithId(
            new mongoose.Types.ObjectId(grant.prospective.fileId),
            'r.csv',
        )
        await new Promise<void>((resolve, reject) => {
            stream.on('finish', () => resolve())
            stream.on('error', reject)
            stream.end(Buffer.from('name,phone\nA,1\n'))
        })

        const handle = await backend.completeWrite(grant.grantId, 15)
        expect(handle.size).toBe(15)
        expect(handle.backend).toBe('gridfs')

        const chunks: Buffer[] = []
        for await (const c of backend.read(handle)) chunks.push(c)
        expect(Buffer.concat(chunks).toString()).toBe('name,phone\nA,1\n')
    })

    it('marks permanent files separately from TTL files', async () => {
        const g1 = await backend.issueWriteGrant({
            sessionId: null, nodeId: null, name: 'a', mime: 'text/plain',
            ttlSeconds: 60, permanent: false, maxBytes: 100,
        })
        expect(g1.prospective.permanent).toBe(false)

        const g2 = await backend.issueWriteGrant({
            sessionId: null, nodeId: null, name: 'b', mime: 'text/plain',
            ttlSeconds: 0, permanent: true, maxBytes: 100,
        })
        expect(g2.prospective.permanent).toBe(true)
    })

    it('rejects completeWrite for an unknown grant', async () => {
        await expect(backend.completeWrite('does-not-exist', 0))
            .rejects.toThrow(/no such grant/)
    })
})
