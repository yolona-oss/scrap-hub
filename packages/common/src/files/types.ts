/**
 * Driver-agnostic file primitives. These types are the contract every file
 * backend (GridFS, S3, local-disk, ...) implements against, and the contract
 * `@cmd-hub/transport`'s upload endpoint and gRPC layer consume.
 *
 * Kept in `@cmd-hub/common` so the transport tier can stay free of mongoose
 * and the AWS SDK.
 */

/** Opaque reference to a stored blob. `backend` is the discriminator (e.g.
 *  `'gridfs'`, `'s3'`); `fileId` is the backend-specific opaque id. */
export interface FileHandle {
    readonly fileId: string
    readonly backend: string
    readonly size: number
    readonly name: string
    readonly mime: string
    readonly permanent: boolean
}

export function isFileHandle(x: unknown): x is FileHandle {
    if (!x || typeof x !== 'object') return false
    const o = x as Record<string, unknown>
    return (
        typeof o.fileId === 'string' &&
        typeof o.backend === 'string' &&
        typeof o.size === 'number' &&
        typeof o.name === 'string' &&
        typeof o.mime === 'string' &&
        typeof o.permanent === 'boolean'
    )
}

/** What a caller asks for when they want to upload a blob. */
export interface WriteGrantInput {
    sessionId: string | null
    nodeId: string | null
    name: string
    mime: string
    /** TTL in seconds; `0` means the backend default (typically 24 h).
     *  Ignored when `permanent` is `true`. */
    ttlSeconds: number
    permanent: boolean
    maxBytes: number
}

/** A grant the backend issues authorising a single upload. The `uploadUrl` is
 *  whatever the backend wants the client to PUT bytes at — for GridFS that's
 *  the hub's `/upload` endpoint, for S3 it's a presigned URL. */
export interface WriteGrant {
    readonly grantId: string
    readonly uploadUrl: string
    readonly token: string
    readonly expiresAt: number
    readonly prospective: FileHandle
}

/**
 * Pluggable file storage backend. Drivers (`@cmd-hub/storage-mongo`,
 * future `@cmd-hub/storage-s3`, …) implement this and publish the instance
 * via `CAP_FileBackend`. The hub-side `FileService` is just a thin façade
 * that delegates everything here.
 */
export interface IFileBackend {
    /** Discriminator for `FileHandle.backend`. */
    readonly name: string
    issueWriteGrant(input: WriteGrantInput): Promise<WriteGrant>
    completeWrite(grantId: string, actualBytes: number): Promise<FileHandle>
    read(handle: FileHandle): AsyncIterable<Buffer>
    stat(handle: FileHandle): Promise<FileHandle>
    delete(handle: FileHandle): Promise<void>
}

/**
 * File metadata record as the hub sees it. The backend is responsible for
 * persisting these; consumers query via `IFileMetadataRepo` for housekeeping
 * (e.g. session-scoped file cleanup, TTL expiry sweeps).
 */
export interface FileMetadata {
    readonly fileId: string
    readonly sessionId: string | null
    readonly nodeId: string | null
    readonly permanent: boolean
    readonly expiresAt: Date | null
    readonly name: string
    readonly mime: string
    readonly size: number
}

export interface IFileMetadataRepo {
    findById(fileId: string): Promise<FileMetadata | null>
    findExpiredBefore(cutoff: Date): Promise<FileMetadata[]>
    deleteById(fileId: string): Promise<void>
    deleteBySessionId(sessionId: string): Promise<number>
}
