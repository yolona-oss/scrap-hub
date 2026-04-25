import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from './models-enum'

export interface InvitationLinkDoc extends Document {
    token: string
    createdBy: number | string
    usedBy: number | string | null
    used: boolean
    expiresAt: Date | null
}

export const InvitationLinkSchema: Schema<InvitationLinkDoc> = new Schema({
    token: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.Mixed, required: true },
    usedBy: { type: Schema.Types.Mixed, default: null },
    used: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
})

export const InvitationLinkModel = mongoose.model<InvitationLinkDoc>(DbModelsEnum.InvitationLinks, InvitationLinkSchema)
export type InvitationLinkHydrated = HydratedDocument<InvitationLinkDoc>
