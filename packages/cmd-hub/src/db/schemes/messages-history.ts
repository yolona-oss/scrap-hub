import { Schema, Document } from 'mongoose';

export interface IMsgHistory extends Document {
    chatId: number,
    userId: number,
    message_id: number,
    text: string,
    isEdited?: boolean
    timestamp?: Date
}

export interface IMsgHistoryDto {
    chatId: number,
    userId: number,
    message_id?: number,
    text: string,
    isEdited?: boolean
    timestamp?: number
}

export const MsgHistorySchema: Schema<IMsgHistory> = new Schema( {
    chatId: { type: Number, required: true },
    userId: { type: Number, required: true },
    message_id: { type: Number, required: false, default: -1 },
    text:   { type: String, required: true },
    isEdited: { type: Boolean, required: false, default: false },
    timestamp: { type: Date, required: true, default: Date.now }
});
