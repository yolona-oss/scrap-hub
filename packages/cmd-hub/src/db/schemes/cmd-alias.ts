import { Schema, Document } from 'mongoose';
import { DbModelsEnum } from '../models-enum';

export interface ICmdAlias extends Document {
    alias: string
    command: string
    owner_id: Schema.Types.ObjectId
}

export const CmdAliasSchema: Schema<ICmdAlias> = new Schema<ICmdAlias>({
    alias: { type: String, required: true },
    command: { type: String, required: true },
    owner_id: { type: Schema.Types.ObjectId, ref: DbModelsEnum.Managers, required: true },
});
