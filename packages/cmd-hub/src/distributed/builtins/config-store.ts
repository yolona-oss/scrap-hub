import mongoose, { Schema } from 'mongoose'

export interface ISystemConfigStore {
    get(module: string, key: string): Promise<string | null>
    set(module: string, key: string, value: string): Promise<void>
    list(module: string): Promise<Record<string, string>>
}

interface SystemConfigDoc {
    module: string
    key: string
    value: string
}

const schema = new Schema<SystemConfigDoc>(
    {
        module: { type: String, required: true, index: true },
        key:    { type: String, required: true },
        value:  { type: String, required: true },
    },
    { collection: 'cmdhub_system_config' },
)
schema.index({ module: 1, key: 1 }, { unique: true })

export const SystemConfigModel = mongoose.model<SystemConfigDoc>('CmdHubSystemConfig', schema)

export class MongoSystemConfigStore implements ISystemConfigStore {
    async get(module: string, key: string): Promise<string | null> {
        const doc = await SystemConfigModel.findOne({ module, key }).lean<SystemConfigDoc | null>()
        return doc?.value ?? null
    }

    async set(module: string, key: string, value: string): Promise<void> {
        await SystemConfigModel.updateOne(
            { module, key },
            { $set: { value } },
            { upsert: true },
        )
    }

    async list(module: string): Promise<Record<string, string>> {
        const docs = await SystemConfigModel.find({ module }).lean<SystemConfigDoc[]>()
        const out: Record<string, string> = {}
        for (const d of docs) out[d.key] = d.value
        return out
    }
}
