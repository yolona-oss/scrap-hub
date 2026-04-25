import type {
    FileHandle,
    IFileBackend,
    WriteGrant,
    WriteGrantInput,
} from '@cmd-hub/common'

/** Driver-agnostic surface the transport tier exposes through gRPC.
 *  Mirrors `IFileBackend` minus the discriminator. */
export type IFileService = Omit<IFileBackend, 'name'>

/**
 * Thin façade over a pluggable `IFileBackend`. The hub gRPC layer holds a
 * `FileService` and delegates everything to whichever backend the storage
 * middleware published (GridFS today, S3 tomorrow).
 */
export class FileService implements IFileService {
    constructor(private readonly backend: IFileBackend) {}

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
