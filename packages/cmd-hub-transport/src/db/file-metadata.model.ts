import mongoose, { Schema } from 'mongoose'

export interface FileMetadataDoc {
    gridFsId: mongoose.Types.ObjectId
    sessionId: string | null
    nodeId: string | null
    permanent: boolean
    expiresAt: Date | null
    name: string
    mime: string
    size: number
}

const schema = new Schema<FileMetadataDoc>(
    {
        gridFsId:  { type: Schema.Types.ObjectId, required: true, unique: true, index: true },
        sessionId: { type: String, default: null, index: true },
        nodeId:    { type: String, default: null, index: true },
        permanent: { type: Boolean, required: true },
        expiresAt: { type: Date,    default: null, index: { expireAfterSeconds: 0 } },
        name:      { type: String,  required: true },
        mime:      { type: String,  required: true },
        size:      { type: Number,  required: true },
    },
    { collection: 'cmdhub_file_metadata' },
)

export const FileMetadataModel = mongoose.model<FileMetadataDoc>('CmdHubFileMetadata', schema)
