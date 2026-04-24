import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { NodeRecordModel } from '../node-record.model'

describe('NodeRecordModel', () => {
    let rs: MongoMemoryReplSet

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('cmdhub-test'))
        // Wait for the unique index to finish building before the test runs;
        // otherwise the duplicate-insert check races with index construction.
        await NodeRecordModel.init()
    }, 120_000)

    afterAll(async () => {
        await mongoose.disconnect()
        await rs.stop()
    })

    it('persists a node record and enforces unique nodeId', async () => {
        await NodeRecordModel.create({
            nodeId: 'n1', nodeName: 'one', state: 'PENDING',
            certFingerprint: 'abc', tokenHash: 'hash', createdVia: 'cli',
            registeredAt: null, lastSeen: null, manifestSnapshotId: null,
        })
        await expect(NodeRecordModel.create({
            nodeId: 'n1', nodeName: 'dup', state: 'PENDING',
            certFingerprint: 'xyz', tokenHash: 'hash2', createdVia: 'cli',
            registeredAt: null, lastSeen: null, manifestSnapshotId: null,
        })).rejects.toThrow(/duplicate key|E11000/)
    })
})
