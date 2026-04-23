import { randomBytes, randomUUID } from 'crypto'
import { NodeRecordModel } from '../db/node-record.model'
import type { NodeRecord, NodeState } from '../types'
import type { ITokenVerifier } from '../auth/types'

export interface ProvisionInput {
    nodeName: string
    certFingerprint: string
    createdVia: 'cli' | 'manual'
    autoActivate: boolean
}
export interface ProvisionOutput {
    nodeId: string
    token: string
}
export interface MarkRegisteredInput {
    presentedToken: string
    presentedFingerprint: string
    manifestSnapshotId: string
}

export class CmdNodeRegistry {
    constructor(private readonly deps: { tokens: ITokenVerifier }) {}

    async provision(input: ProvisionInput): Promise<ProvisionOutput> {
        const nodeId = randomUUID()
        const token = randomBytes(32).toString('hex')
        const tokenHash = await this.deps.tokens.hash(token)
        const state: NodeState = input.autoActivate ? 'ACTIVE' : 'PENDING'
        await NodeRecordModel.create({
            nodeId,
            nodeName: input.nodeName,
            state,
            certFingerprint: input.certFingerprint,
            tokenHash,
            createdVia: input.createdVia,
            registeredAt: null,
            lastSeen: null,
            manifestSnapshotId: null,
        })
        return { nodeId, token }
    }

    async get(nodeId: string): Promise<NodeRecord | null> {
        return NodeRecordModel.findOne({ nodeId }).lean<NodeRecord | null>()
    }

    async list(): Promise<NodeRecord[]> {
        return NodeRecordModel.find({}).lean<NodeRecord[]>()
    }

    async approve(nodeId: string): Promise<void> {
        const res = await NodeRecordModel.updateOne(
            { nodeId, state: 'PENDING' },
            { $set: { state: 'ACTIVE' } },
        )
        if (res.modifiedCount === 0) {
            throw new Error(`cannot approve node ${nodeId} (not PENDING)`)
        }
    }

    async deregister(nodeId: string): Promise<void> {
        await NodeRecordModel.updateOne({ nodeId }, { $set: { state: 'DISABLED' } })
    }

    async forget(nodeId: string): Promise<void> {
        await NodeRecordModel.deleteOne({ nodeId })
    }

    async markRegistered(nodeId: string, input: MarkRegisteredInput): Promise<NodeRecord> {
        const rec = await NodeRecordModel.findOne({ nodeId })
        if (!rec) throw new Error(`unknown node: ${nodeId}`)
        if (rec.state === 'DISABLED') throw new Error(`node ${nodeId} is DISABLED`)
        if (rec.certFingerprint !== input.presentedFingerprint) {
            throw new Error(`certificate fingerprint mismatch for node ${nodeId}`)
        }
        const ok = await this.deps.tokens.verify(input.presentedToken, rec.tokenHash)
        if (!ok) throw new Error(`invalid token for node ${nodeId}`)
        rec.registeredAt = Date.now()
        rec.lastSeen = Date.now()
        rec.manifestSnapshotId = input.manifestSnapshotId
        await rec.save()
        return rec.toObject() as unknown as NodeRecord
    }

    async touchLastSeen(nodeId: string): Promise<void> {
        await NodeRecordModel.updateOne({ nodeId }, { $set: { lastSeen: Date.now() } })
    }
}
