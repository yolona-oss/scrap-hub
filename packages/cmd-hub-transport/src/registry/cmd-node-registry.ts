import { randomBytes, randomUUID } from 'crypto'
import type { INodeRecordRepo, NodeRecord, NodeState } from '@cmd-hub/common'
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

/**
 * Provisioning + lifecycle for cmd-nodes. Persists records via the abstract
 * `INodeRecordRepo` so the registry has no direct dependency on mongoose.
 */
export class CmdNodeRegistry {
    constructor(private readonly deps: { tokens: ITokenVerifier; repo: INodeRecordRepo }) {}

    async provision(input: ProvisionInput): Promise<ProvisionOutput> {
        const nodeId = randomUUID()
        const token = randomBytes(32).toString('hex')
        const tokenHash = await this.deps.tokens.hash(token)
        const state: NodeState = input.autoActivate ? 'ACTIVE' : 'PENDING'
        await this.deps.repo.create({
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
        return this.deps.repo.findById(nodeId)
    }

    async list(): Promise<NodeRecord[]> {
        return this.deps.repo.list()
    }

    async approve(nodeId: string): Promise<void> {
        const changed = await this.deps.repo.setState(nodeId, 'ACTIVE', { onlyIfState: 'PENDING' })
        if (changed === 0) {
            throw new Error(`cannot approve node ${nodeId} (not PENDING)`)
        }
    }

    async deregister(nodeId: string): Promise<void> {
        await this.deps.repo.setState(nodeId, 'DISABLED')
    }

    async forget(nodeId: string): Promise<void> {
        await this.deps.repo.deleteById(nodeId)
    }

    async markRegistered(nodeId: string, input: MarkRegisteredInput): Promise<NodeRecord> {
        const rec = await this.deps.repo.findById(nodeId)
        if (!rec) throw new Error(`unknown node: ${nodeId}`)
        if (rec.state === 'DISABLED') throw new Error(`node ${nodeId} is DISABLED`)
        if (rec.certFingerprint !== input.presentedFingerprint) {
            throw new Error(`certificate fingerprint mismatch for node ${nodeId}`)
        }
        const ok = await this.deps.tokens.verify(input.presentedToken, rec.tokenHash)
        if (!ok) throw new Error(`invalid token for node ${nodeId}`)
        const now = Date.now()
        const updated = await this.deps.repo.markRegistered(nodeId, {
            registeredAt: now,
            lastSeen: now,
            manifestSnapshotId: input.manifestSnapshotId,
        })
        if (!updated) throw new Error(`failed to update node record: ${nodeId}`)
        return updated
    }

    async touchLastSeen(nodeId: string): Promise<void> {
        await this.deps.repo.touchLastSeen(nodeId, Date.now())
    }
}
