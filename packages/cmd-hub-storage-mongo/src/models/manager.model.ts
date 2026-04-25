import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from './models-enum'

/**
 * Mongoose-internal Manager document. Schema methods (message-history ops,
 * etc.) live on the handle wrapper in `repos/manager.repo.ts` instead of
 * being attached to the schema — keeps cross-document mongoose calls out of
 * the model and inside the impl-level handle code.
 */
export interface ManagerDoc extends Document {
    userId: number
    name: string
    isAdmin?: boolean
    online?: boolean
    useGreeting?: boolean
    account: mongoose.Types.ObjectId | null
    messageWidth?: number
    passwordHash?: string
}

export const ManagerSchema: Schema<ManagerDoc> = new Schema({
    userId: { type: Number, required: true, unique: true },
    name: { type: String, required: true, unique: true },
    isAdmin: { type: Boolean, required: false, default: false },
    online: { type: Boolean, required: false, default: false },
    useGreeting: { type: Boolean, required: false, default: true },
    account: { type: Schema.Types.ObjectId, ref: DbModelsEnum.Accounts, default: null },
    messageWidth: { type: Number, required: false, default: undefined },
    passwordHash: { type: String, required: false, default: undefined },
})

export const ManagerModel = mongoose.model<ManagerDoc>(DbModelsEnum.Managers, ManagerSchema)
export type ManagerHydrated = HydratedDocument<ManagerDoc>
