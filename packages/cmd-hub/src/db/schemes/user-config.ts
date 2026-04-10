import { Schema, Document } from 'mongoose'

export interface IUserConfig extends Document {
    userId: string
    module: string
    data: Record<string, any>
}

export const UserConfigSchema: Schema<IUserConfig> = new Schema({
    userId: { type: String, required: true, index: true },
    module: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: {} },
})

UserConfigSchema.index({ userId: 1, module: 1 }, { unique: true })
