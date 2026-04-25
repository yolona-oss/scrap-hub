import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from '../models-enum'

const MODULE_NAME_RE = /^[\:a-zA-Z0-9_]+$/

export function isValidModuleName(name: string): boolean {
    return MODULE_NAME_RE.test(name)
}

/**
 * Per-Account, per-service data bucket. `data` is a free-form Mixed payload
 * owned by the consuming service.
 */
export interface AccountModuleDoc extends Document {
    name: string
    data: Record<string, unknown>
    account_id: mongoose.Types.ObjectId
    session_ids: mongoose.Types.ObjectId[]
}

export const AccountModuleSchema: Schema<AccountModuleDoc> = new Schema(
    {
        name: { type: String, required: true, readonly: true },
        data: { type: Schema.Types.Mixed, required: false, default: {} },
        session_ids: { type: [Schema.Types.ObjectId], ref: DbModelsEnum.AccountSessions, required: false, default: [] },
        account_id: { type: Schema.Types.ObjectId, ref: DbModelsEnum.Accounts, required: true },
    },
    { timestamps: true },
)

AccountModuleSchema.pre('save', function(next) {
    if (!isValidModuleName(this.name)) {
        next(new Error('Invalid module name'))
    } else {
        next()
    }
})

export const AccountModuleModel = mongoose.model<AccountModuleDoc>(DbModelsEnum.AccountModules, AccountModuleSchema)
export type AccountModuleHydrated = HydratedDocument<AccountModuleDoc>
