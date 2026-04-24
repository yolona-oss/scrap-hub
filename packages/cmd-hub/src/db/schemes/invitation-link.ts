import mongoose, { Schema, Document } from 'mongoose'

export interface IInvitationLink extends Document {
    token: string
    createdBy: number | string
    usedBy?: number | string
    used: boolean
    expiresAt?: Date
}

const InvitationLinkSchema = new Schema<IInvitationLink>({
    token: { type: String, required: true, unique: true },
    createdBy: { type: Schema.Types.Mixed, required: true },
    usedBy: { type: Schema.Types.Mixed, default: null },
    used: { type: Boolean, default: false },
    expiresAt: { type: Date, default: null },
})

export const InvitationLink = (mongoose.models.InvitationLink as mongoose.Model<IInvitationLink>)
    || mongoose.model<IInvitationLink>('InvitationLink', InvitationLinkSchema)
