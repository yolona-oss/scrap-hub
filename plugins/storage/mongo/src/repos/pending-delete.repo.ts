import type {
    IPendingDeleteRepo,
    PendingDeleteRecord,
    PendingDeleteUpsertInput,
} from '@cmd-hub/common'
import { PendingDeleteModel, type PendingDeleteHydrated } from '../models/pending-delete.model'

function toRecord(doc: PendingDeleteHydrated): PendingDeleteRecord {
    return {
        userId: doc.userId,
        messageId: doc.messageId,
        type: doc.type,
        createdAt: doc.createdAt,
        deleteAfter: doc.deleteAfter,
    }
}

export class MongoPendingDeleteRepo implements IPendingDeleteRepo {
    async list(): Promise<PendingDeleteRecord[]> {
        const docs = await PendingDeleteModel.find({})
        return docs.map(toRecord)
    }

    async upsert(input: PendingDeleteUpsertInput): Promise<void> {
        await PendingDeleteModel.updateOne(
            { userId: input.userId, messageId: input.messageId },
            {
                userId:      input.userId,
                messageId:   input.messageId,
                type:        input.type,
                createdAt:   input.createdAt,
                deleteAfter: input.deleteAfter,
            },
            { upsert: true },
        )
    }

    async deleteOne(userId: string, messageId: string): Promise<void> {
        await PendingDeleteModel.deleteOne({ userId, messageId })
    }

    async deleteAll(): Promise<void> {
        await PendingDeleteModel.deleteMany({})
    }
}
