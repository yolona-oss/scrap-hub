import mongoose, { Schema, type HydratedDocument } from 'mongoose'

export interface SystemConfigDoc {
    module: string
    data: Record<string, unknown>
}

const schema = new Schema<SystemConfigDoc>({
    module: { type: String, required: true, unique: true, index: true },
    data: { type: Schema.Types.Mixed, default: {} },
})

export const SystemConfigModel = mongoose.model<SystemConfigDoc>('SystemConfig', schema)
export type SystemConfigHydrated = HydratedDocument<SystemConfigDoc>
