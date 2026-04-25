import type { IUserConfigRepo } from '@cmd-hub/common'
import { UserConfigModel } from '../models/user-config.model'

export class MongoUserConfigRepo implements IUserConfigRepo {
    async findByUserAndModule(
        userId: string,
        module: string,
    ): Promise<{ data: Record<string, unknown> } | null> {
        const doc = await UserConfigModel.findOne({ userId, module })
            .lean<{ data: Record<string, unknown> } | null>()
        return doc ?? null
    }

    async setPath(userId: string, module: string, path: string, value: unknown): Promise<void> {
        await UserConfigModel.findOneAndUpdate(
            { userId, module },
            { $set: { [`data.${path}`]: value } },
            { upsert: true, new: true },
        )
    }

    async clear(userId: string, module: string): Promise<void> {
        await UserConfigModel.findOneAndUpdate(
            { userId, module },
            { $set: { data: {} } },
            { upsert: true },
        )
    }
}
