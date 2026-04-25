import mongoose, { Schema, Document, type HydratedDocument } from 'mongoose'
import { DbModelsEnum } from './models-enum'

export interface CmdAliasDoc extends Document {
    alias: string
    command: string
    owner_id: mongoose.Types.ObjectId
}

export const CmdAliasSchema: Schema<CmdAliasDoc> = new Schema({
    alias: { type: String, required: true },
    command: { type: String, required: true },
    owner_id: { type: Schema.Types.ObjectId, ref: DbModelsEnum.Managers, required: true },
})

export const CmdAliasModel = mongoose.model<CmdAliasDoc>(DbModelsEnum.CmdAliases, CmdAliasSchema)
export type CmdAliasHydrated = HydratedDocument<CmdAliasDoc>
