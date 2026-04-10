import { Schema, Document } from 'mongoose';

export interface IFile extends Document {
    mime: string;
    path: string;
    group: string;
}

export const FileSchema: Schema<IFile> = new Schema({
    mime: { type: String, required: true },
    path: { type: String, required: true },
    group: { type: String, required: true },
});
