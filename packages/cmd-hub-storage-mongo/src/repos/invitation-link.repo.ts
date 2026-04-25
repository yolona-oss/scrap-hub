import type {
    IInvitationLinkRepo,
    InvitationLinkRecord,
    CreateInvitationLinkInput,
} from '@cmd-hub/common'
import { InvitationLinkModel, type InvitationLinkHydrated } from '../models/invitation-link.model'

function toRecord(doc: InvitationLinkHydrated): InvitationLinkRecord {
    return {
        id: doc._id.toHexString(),
        token: doc.token,
        createdBy: doc.createdBy,
        usedBy: doc.usedBy ?? null,
        used: doc.used,
        expiresAt: doc.expiresAt ?? null,
    }
}

export class MongoInvitationLinkRepo implements IInvitationLinkRepo {
    async create(input: CreateInvitationLinkInput): Promise<InvitationLinkRecord> {
        const doc = await InvitationLinkModel.create({
            token: input.token,
            createdBy: input.createdBy,
            expiresAt: input.expiresAt ?? null,
        })
        return toRecord(doc)
    }

    async findByToken(
        token: string,
        options: { onlyUnused?: boolean } = {},
    ): Promise<InvitationLinkRecord | null> {
        const filter: Record<string, unknown> = { token }
        if (options.onlyUnused) filter.used = false
        const doc = await InvitationLinkModel.findOne(filter)
        return doc ? toRecord(doc) : null
    }

    async listRecent(limit: number): Promise<InvitationLinkRecord[]> {
        const docs = await InvitationLinkModel.find({}).sort({ _id: -1 }).limit(limit)
        return docs.map(toRecord)
    }

    async markUsed(token: string, usedBy: number | string): Promise<void> {
        await InvitationLinkModel.updateOne(
            { token, used: false },
            { $set: { used: true, usedBy } },
        )
    }
}
