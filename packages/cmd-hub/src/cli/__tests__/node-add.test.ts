/**
 * Integration test for the node-add CLI flow. Avoids spawning a child process
 * (which would need the CLI pre-built) by invoking the same registry + CA
 * helpers the CLI uses.
 */
import { MongoMemoryReplSet } from 'mongodb-memory-server'
import mongoose from 'mongoose'
import { CmdNodeRegistry } from '../../distributed/registry/cmd-node-registry'
import { NodeRecordModel } from '../../distributed/db/node-record.model'
import { InternalTokenVerifier } from '../../distributed/auth/internal-token-verifier'
import { InternalCertVerifier } from '../../distributed/auth/internal-cert-verifier'
import { createCA, signNodeCert } from '../ca'

describe('node-add flow', () => {
    let rs: MongoMemoryReplSet
    beforeAll(async () => {
        rs = await MongoMemoryReplSet.create({ replSet: { count: 1 } })
        await mongoose.connect(rs.getUri('node-add-test'))
        await NodeRecordModel.init()
    }, 180_000)
    afterAll(async () => {
        await mongoose.disconnect()
        await rs.stop()
    })

    it('provisions a node and signs a cert whose fingerprint matches the stored record', async () => {
        const ca = createCA('cmd-hub-test-ca')
        const reg = new CmdNodeRegistry({ tokens: new InternalTokenVerifier(4) })

        const provisioned = await reg.provision({
            nodeName: 'scraper-1',
            certFingerprint: 'PENDING',
            createdVia: 'cli',
            autoActivate: true,
        })
        const material = signNodeCert(ca, provisioned.nodeId)

        await NodeRecordModel.updateOne(
            { nodeId: provisioned.nodeId },
            { $set: { certFingerprint: material.fingerprint } },
        )

        // The cert's true fingerprint agrees with what InternalCertVerifier computes.
        const verifier = new InternalCertVerifier()
        expect(verifier.fingerprint(material.certPem)).toBe(material.fingerprint)

        // markRegistered succeeds when the presented cert matches.
        const updated = await reg.markRegistered(provisioned.nodeId, {
            presentedToken: provisioned.token,
            presentedFingerprint: material.fingerprint,
            manifestSnapshotId: 'snap-1',
        })
        expect(updated.state).toBe('ACTIVE')

        // markRegistered fails for a different fingerprint.
        const other = signNodeCert(ca, 'imposter')
        await expect(reg.markRegistered(provisioned.nodeId, {
            presentedToken: provisioned.token,
            presentedFingerprint: other.fingerprint,
            manifestSnapshotId: 'snap-1',
        })).rejects.toThrow(/fingerprint/)
    })

    it('signs two nodes with distinct fingerprints against the same CA', async () => {
        const ca = createCA('cmd-hub-test-ca')
        const a = signNodeCert(ca, 'node-a')
        const b = signNodeCert(ca, 'node-b')
        expect(a.fingerprint).not.toBe(b.fingerprint)
        expect(a.certPem).toContain('BEGIN CERTIFICATE')
        expect(b.keyPem).toContain('BEGIN RSA PRIVATE KEY')
    })
})
