import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from '../models-enum'

export const DEFAULT_ACCOUNT_SESSION_NAME = 'default_session'
export const DEFAULT_INCREMENTAL_EXPIRITY_OPT = true
export const DEFAULT_SERVICE_SESSION_EXPIRITY = 1000 * 60 * 60 * 24 * 2

export interface AccountSessionDoc extends Document {
    name: string
    createTime: number
    expirity: number
    initialExpirity: number
    incrementalExpirity: boolean
    data: Record<string, unknown>
}

export const AccountSessionSchema: Schema<AccountSessionDoc> = new Schema({
    name: { type: String, required: false, default: DEFAULT_ACCOUNT_SESSION_NAME, readonly: true },
    createTime: { type: Number, required: false, default: Date.now },
    expirity: { type: Number, required: true },
    initialExpirity: { type: Number, required: false, default: 0 },
    incrementalExpirity: { type: Boolean, required: false, default: DEFAULT_INCREMENTAL_EXPIRITY_OPT },
    data: { type: Schema.Types.Mixed, required: false, default: {} },
})

AccountSessionSchema.pre('save', function(next) {
    if (this.isNew) {
        this.initialExpirity = this.expirity
    }
    next()
})

export const AccountSessionModel = mongoose.model<AccountSessionDoc>(DbModelsEnum.AccountSessions, AccountSessionSchema)
export type AccountSessionHydrated = HydratedDocument<AccountSessionDoc>
