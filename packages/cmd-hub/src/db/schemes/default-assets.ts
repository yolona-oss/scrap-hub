import { Schema, Document } from 'mongoose';
import { DbModelsEnum } from '../models-enum';

export enum DefaultAssetsEnum {
    avatar = 'default_avatar'
}

export interface IDefaultAssets extends Document {
    name: string
    file_id: Schema.Types.ObjectId
}

export const DefaultAssetsSchema: Schema<IDefaultAssets> = new Schema({
    name: { type: String, required: true },
    file_id: { type: Schema.Types.ObjectId, ref: DbModelsEnum.Files, required: true },
})
