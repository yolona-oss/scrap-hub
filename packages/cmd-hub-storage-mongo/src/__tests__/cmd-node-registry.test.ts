import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { CmdNodeRegistry, InternalTokenVerifier } from '@cmd-hub/transport'
import { MongoNodeRecordRepo } from '../repos/node-record.repo'

describe('CmdNodeRegistry (mongo-backed)', () => {
    let rs: MongoMemoryReplSet
    let repo: MongoNodeRecordRepo

    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('reg-test'))
        repo = new MongoNodeRecordRepo()
    }, 120_000)

    afterAll(async () => {
        await mongoose.disconnect()
        await rs.stop()
    })

    it('provision + approve + deregister + forget lifecycle', async () => {
        const reg = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4), repo })

        const { nodeId, token } = await reg.provision({
            nodeName: 'scraper-a', certFingerprint: 'ffff',
            createdVia: 'cli', autoActivate: false,
        })
        expect((await reg.get(nodeId))!.state).toBe('PENDING')

        await reg.approve(nodeId)
        expect((await reg.get(nodeId))!.state).toBe('ACTIVE')

        await reg.markRegistered(nodeId, {
            presentedToken: token, presentedFingerprint: 'ffff', manifestSnapshotId: 'snap-1',
        })
        const touched = await reg.get(nodeId)
        expect(touched!.registeredAt).not.toBeNull()

        await reg.deregister(nodeId)
        expect((await reg.get(nodeId))!.state).toBe('DISABLED')

        await reg.forget(nodeId)
        expect(await reg.get(nodeId)).toBeNull()
    })

    it('markRegistered rejects bad fingerprint or token', async () => {
        const reg = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4), repo })
        const { nodeId, token } = await reg.provision({
            nodeName: 'x', certFingerprint: 'aaaa',
            createdVia: 'manual', autoActivate: true,
        })
        await expect(reg.markRegistered(nodeId, {
            presentedToken: token, presentedFingerprint: 'WRONG', manifestSnapshotId: 's',
        })).rejects.toThrow(/fingerprint/)
        await expect(reg.markRegistered(nodeId, {
            presentedToken: 'bad', presentedFingerprint: 'aaaa', manifestSnapshotId: 's',
        })).rejects.toThrow(/token/)
    })

    it('approve throws when node is not PENDING', async () => {
        const reg = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4), repo })
        const { nodeId } = await reg.provision({
            nodeName: 'y', certFingerprint: 'bbbb',
            createdVia: 'cli', autoActivate: true,
        })
        await expect(reg.approve(nodeId)).rejects.toThrow(/not PENDING/)
    })
})
