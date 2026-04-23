import type { FileServiceBackend, IFileService, WriteGrantInput } from './types'
import type { FileHandle, WriteGrant } from '../types'

/** Thin facade over a pluggable storage backend. */
export class FileService implements IFileService {
    constructor(private readonly backend: FileServiceBackend) {}

    issueWriteGrant(req: WriteGrantInput): Promise<WriteGrant> {
        return this.backend.issueWriteGrant(req)
    }
    completeWrite(grantId: string, actualBytes: number): Promise<FileHandle> {
        return this.backend.completeWrite(grantId, actualBytes)
    }
    read(handle: FileHandle): AsyncIterable<Buffer> {
        return this.backend.read(handle)
    }
    stat(handle: FileHandle): Promise<FileHandle> {
        return this.backend.stat(handle)
    }
    delete(handle: FileHandle): Promise<void> {
        return this.backend.delete(handle)
    }
}
