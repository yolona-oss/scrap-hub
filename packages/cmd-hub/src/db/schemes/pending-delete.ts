import { Schema, Document } from 'mongoose'

export interface IPendingDelete extends Document {
    userId: string
    messageId: string
    type: string
    createdAt: number
    deleteAfter: number  // timestamp when it should be deleted
}

export const PendingDeleteSchema: Schema<IPendingDelete> = new Schema({
    userId: { type: String, required: true, index: true },
    messageId: { type: String, required: true },
    type: { type: String, required: true },
    createdAt: { type: Number, required: true },
    deleteAfter: { type: Number, required: true },
})
