import type { FileHandle, WriteGrant } from '../types'

export interface WriteGrantInput {
    sessionId: string | null
    nodeId: string | null
    name: string
    mime: string
    ttlSeconds: number   // 0 means the backend default (24 h)
    permanent: boolean
    maxBytes: number
}

export interface FileServiceBackend {
    readonly name: string
    issueWriteGrant(req: WriteGrantInput): Promise<WriteGrant>
    completeWrite(grantId: string, actualBytes: number): Promise<FileHandle>
    read(handle: FileHandle): AsyncIterable<Buffer>
    stat(handle: FileHandle): Promise<FileHandle>
    delete(handle: FileHandle): Promise<void>
}

export type IFileService = Omit<FileServiceBackend, 'name'>
