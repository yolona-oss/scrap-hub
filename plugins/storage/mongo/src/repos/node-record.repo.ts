import type { INodeRecordRepo, NodeRecord, NodeState } from '@cmd-hub/common'
import { NodeRecordModel } from '../models/node-record.model'

export class MongoNodeRecordRepo implements INodeRecordRepo {
    async create(record: NodeRecord): Promise<void> {
        await NodeRecordModel.create(record)
    }

    async findById(nodeId: string): Promise<NodeRecord | null> {
        return NodeRecordModel.findOne({ nodeId }).lean<NodeRecord | null>()
    }

    async list(): Promise<NodeRecord[]> {
        return NodeRecordModel.find({}).lean<NodeRecord[]>()
    }

    async setState(
        nodeId: string,
        state: NodeState,
        options: { onlyIfState?: NodeState } = {},
    ): Promise<number> {
        const filter: Record<string, unknown> = { nodeId }
        if (options.onlyIfState) filter.state = options.onlyIfState
        const res = await NodeRecordModel.updateOne(filter, { $set: { state } })
        return res.modifiedCount ?? 0
    }

    async markRegistered(
        nodeId: string,
        patch: { registeredAt: number; lastSeen: number; manifestSnapshotId: string },
    ): Promise<NodeRecord | null> {
        const doc = await NodeRecordModel.findOneAndUpdate(
            { nodeId },
            { $set: patch },
            { new: true },
        ).lean<NodeRecord | null>()
        return doc ?? null
    }

    async touchLastSeen(nodeId: string, ts: number): Promise<void> {
        await NodeRecordModel.updateOne({ nodeId }, { $set: { lastSeen: ts } })
    }

    async deleteById(nodeId: string): Promise<void> {
        await NodeRecordModel.deleteOne({ nodeId })
    }
}
