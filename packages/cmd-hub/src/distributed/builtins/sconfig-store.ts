import mongoose, { Schema } from 'mongoose'

export interface IAccountModuleStore {
    get(userId: string, module: string, key: string): Promise<string | null>
    set(userId: string, module: string, key: string, value: string): Promise<void>
    list(userId: string, module: string): Promise<Record<string, string>>
}

interface AccountConfigDoc {
    userId: string
    module: string
    key: string
    value: string
}

const schema = new Schema<AccountConfigDoc>(
    {
        userId: { type: String, required: true, index: true },
        module: { type: String, required: true, index: true },
        key:    { type: String, required: true },
        value:  { type: String, required: true },
    },
    { collection: 'cmdhub_account_config' },
)
schema.index({ userId: 1, module: 1, key: 1 }, { unique: true })

export const AccountConfigModel = mongoose.model<AccountConfigDoc>('CmdHubAccountConfig', schema)

export class MongoAccountModuleStore implements IAccountModuleStore {
    async get(userId: string, module: string, key: string): Promise<string | null> {
        const doc = await AccountConfigModel.findOne({ userId, module, key }).lean<AccountConfigDoc | null>()
        return doc?.value ?? null
    }
    async set(userId: string, module: string, key: string, value: string): Promise<void> {
        await AccountConfigModel.updateOne(
            { userId, module, key },
            { $set: { value } },
            { upsert: true },
        )
    }
    async list(userId: string, module: string): Promise<Record<string, string>> {
        const docs = await AccountConfigModel.find({ userId, module }).lean<AccountConfigDoc[]>()
        const out: Record<string, string> = {}
        for (const d of docs) out[d.key] = d.value
        return out
    }
}
