import type { ISystemConfigRepo } from '@cmd-hub/common'
import { SystemConfigModel } from '../models/system-config.model'

export class MongoSystemConfigRepo implements ISystemConfigRepo {
    async findByModule(name: string): Promise<{ data: Record<string, unknown> } | null> {
        const doc = await SystemConfigModel.findOne({ module: name }).lean<{ data: Record<string, unknown> } | null>()
        return doc ?? null
    }

    async insertIfAbsent(name: string, data: Record<string, unknown>): Promise<void> {
        const existing = await SystemConfigModel.findOne({ module: name }).lean()
        if (existing) return
        await SystemConfigModel.create({ module: name, data })
    }

    async setPath(name: string, path: string, value: unknown): Promise<void> {
        await SystemConfigModel.findOneAndUpdate(
            { module: name },
            { $set: { [`data.${path}`]: value } },
            { upsert: true, new: true },
        )
    }

    async clear(name: string): Promise<void> {
        await SystemConfigModel.findOneAndUpdate(
            { module: name },
            { $set: { data: {} } },
            { upsert: true },
        )
    }
}
