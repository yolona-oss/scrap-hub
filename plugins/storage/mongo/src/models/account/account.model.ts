import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from '../models-enum'

/**
 * Mongoose-internal Account document. Module operations
 * (`getModuleByNameOrCreate`, `deleteModule`, etc.) live on the handle wrapper
 * in `repos/account.repo.ts` rather than as schema methods — that way the
 * cross-document mongoose calls are concentrated in the impl boundary.
 */
export interface AccountDoc extends Document {
    owner_id: mongoose.Types.ObjectId
    module_ids: mongoose.Types.ObjectId[]
}

export const AccountSchema: Schema<AccountDoc> = new Schema({
    owner_id: { type: Schema.Types.ObjectId, ref: DbModelsEnum.Managers, required: true },
    module_ids: { type: [Schema.Types.ObjectId], ref: DbModelsEnum.AccountModules, default: [] },
})

export const AccountModel = mongoose.model<AccountDoc>(DbModelsEnum.Accounts, AccountSchema)
export type AccountHydrated = HydratedDocument<AccountDoc>
