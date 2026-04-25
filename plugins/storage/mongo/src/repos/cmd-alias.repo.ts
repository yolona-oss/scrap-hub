import mongoose from 'mongoose'
import type {
    ICmdAliasRepo,
    CmdAliasRecord,
    CreateCmdAliasInput,
} from '@cmd-hub/common'
import { CmdAliasModel, type CmdAliasHydrated } from '../models/cmd-alias.model'

function toRecord(doc: CmdAliasHydrated): CmdAliasRecord {
    return {
        id: doc._id.toHexString(),
        alias: doc.alias,
        command: doc.command,
        ownerId: doc.owner_id.toHexString(),
    }
}

export class MongoCmdAliasRepo implements ICmdAliasRepo {
    async listByOwner(ownerId: string): Promise<CmdAliasRecord[]> {
        const docs = await CmdAliasModel.find({ owner_id: new mongoose.Types.ObjectId(ownerId) })
        return docs.map(toRecord)
    }

    async findByOwnerAndAlias(ownerId: string, alias: string): Promise<CmdAliasRecord | null> {
        const doc = await CmdAliasModel.findOne({
            owner_id: new mongoose.Types.ObjectId(ownerId),
            alias,
        })
        return doc ? toRecord(doc) : null
    }

    async create(input: CreateCmdAliasInput): Promise<void> {
        await CmdAliasModel.create({
            alias: input.alias,
            command: input.command,
            owner_id: new mongoose.Types.ObjectId(input.ownerId),
        })
    }

    async deleteByOwnerAndAlias(ownerId: string, alias: string): Promise<number> {
        const res = await CmdAliasModel.deleteOne({
            owner_id: new mongoose.Types.ObjectId(ownerId),
            alias,
        })
        return res.deletedCount ?? 0
    }
}
