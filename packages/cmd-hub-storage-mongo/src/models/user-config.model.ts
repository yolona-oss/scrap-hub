import mongoose, { Schema, type HydratedDocument } from 'mongoose'

export interface UserConfigDoc {
    userId: string
    module: string
    data: Record<string, unknown>
}

const schema = new Schema<UserConfigDoc>({
    userId: { type: String, required: true, index: true },
    module: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
})

schema.index({ userId: 1, module: 1 }, { unique: true })

export const UserConfigModel = mongoose.model<UserConfigDoc>('UserConfig', schema)
export type UserConfigHydrated = HydratedDocument<UserConfigDoc>
