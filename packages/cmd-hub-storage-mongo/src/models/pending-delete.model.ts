import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from './models-enum'

export interface PendingDeleteDoc extends Document {
    userId: string
    messageId: string
    type: string
    createdAt: number
    deleteAfter: number
}

export const PendingDeleteSchema: Schema<PendingDeleteDoc> = new Schema({
    userId: { type: String, required: true, index: true },
    messageId: { type: String, required: true },
    type: { type: String, required: true },
    createdAt: { type: Number, required: true },
    deleteAfter: { type: Number, required: true },
})

export const PendingDeleteModel = mongoose.model<PendingDeleteDoc>(DbModelsEnum.PendingDeletes, PendingDeleteSchema)
export type PendingDeleteHydrated = HydratedDocument<PendingDeleteDoc>
