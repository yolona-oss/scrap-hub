import { Schema, Document } from 'mongoose'

export interface ISystemConfig extends Document {
    module: string
    data: Record<string, any>
}

export const SystemConfigSchema: Schema<ISystemConfig> = new Schema({
    module: { type: String, required: true, unique: true, index: true },
    data: { type: Schema.Types.Mixed, default: {} },
})
