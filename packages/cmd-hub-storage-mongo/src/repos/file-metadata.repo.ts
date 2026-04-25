import mongoose from 'mongoose'
import type { IFileMetadataRepo, FileMetadata } from '@cmd-hub/common'
import { FileMetadataModel, type FileMetadataDoc } from '../models/file-metadata.model'

function toFileMetadata(doc: FileMetadataDoc): FileMetadata {
    return {
        fileId:    doc.gridFsId.toHexString(),
        sessionId: doc.sessionId,
        nodeId:    doc.nodeId,
        permanent: doc.permanent,
        expiresAt: doc.expiresAt,
        name:      doc.name,
        mime:      doc.mime,
        size:      doc.size,
    }
}

export class MongoFileMetadataRepo implements IFileMetadataRepo {
    async findById(fileId: string): Promise<FileMetadata | null> {
        const doc = await FileMetadataModel.findOne({
            gridFsId: new mongoose.Types.ObjectId(fileId),
        }).lean<FileMetadataDoc | null>()
        return doc ? toFileMetadata(doc) : null
    }

    async findExpiredBefore(cutoff: Date): Promise<FileMetadata[]> {
        const docs = await FileMetadataModel.find({
            permanent: false,
            expiresAt: { $ne: null, $lt: cutoff },
        }).lean<FileMetadataDoc[]>()
        return docs.map(toFileMetadata)
    }

    async deleteById(fileId: string): Promise<void> {
        await FileMetadataModel.deleteOne({
            gridFsId: new mongoose.Types.ObjectId(fileId),
        })
    }

    async deleteBySessionId(sessionId: string): Promise<number> {
        const res = await FileMetadataModel.deleteMany({ sessionId })
        return res.deletedCount ?? 0
    }
}
