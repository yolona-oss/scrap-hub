import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from './models-enum'

export interface SessionLogDoc extends Document {
    session_id: string
    seq: number
    ts: number
    kind: string
    severity?: string
    payload: Record<string, unknown>
    compatibility_id: string
    version: string
}

export const SessionLogSchema: Schema<SessionLogDoc> = new Schema({
    session_id: { type: String, required: true },
    seq: { type: Number, required: true },
    ts: { type: Number, required: true },
    kind: { type: String, required: true },
    severity: { type: String },
    payload: { type: Schema.Types.Mixed, required: true },
    compatibility_id: { type: String, required: true },
    version: { type: String, required: true },
})

// Compound unique index: one (sessionId, seq) tuple per row. Doubles as
// the lookup index for `read(sessionId, ...)` and `latestSeq(sessionId)`.
SessionLogSchema.index({ session_id: 1, seq: 1 }, { unique: true })

export const SessionLogModel = mongoose.model<SessionLogDoc>(DbModelsEnum.SessionLog, SessionLogSchema)
export type SessionLogHydrated = HydratedDocument<SessionLogDoc>
