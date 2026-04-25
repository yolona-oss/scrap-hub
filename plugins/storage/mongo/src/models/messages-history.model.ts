import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from './models-enum'

export interface MsgHistoryDoc extends Document {
    chatId: number
    userId: number
    message_id: number
    text: string
    isEdited?: boolean
    timestamp?: Date
}

export const MsgHistorySchema: Schema<MsgHistoryDoc> = new Schema({
    chatId: { type: Number, required: true },
    userId: { type: Number, required: true },
    message_id: { type: Number, required: false, default: -1 },
    text: { type: String, required: true },
    isEdited: { type: Boolean, required: false, default: false },
    timestamp: { type: Date, required: true, default: Date.now },
})

export const MsgHistoryModel = mongoose.model<MsgHistoryDoc>(DbModelsEnum.MsgHistory, MsgHistorySchema)
export type MsgHistoryHydrated = HydratedDocument<MsgHistoryDoc>
