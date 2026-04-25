import mongoose from 'mongoose'
import { randomBytes } from 'crypto'
import type {
    FileHandle,
    IFileBackend,
    WriteGrant,
    WriteGrantInput,
} from '@cmd-hub/common'
import { FileMetadataModel } from '../models/file-metadata.model'

const DEFAULT_TTL_SEC = 24 * 60 * 60
const GRANT_TTL_MS = 60_000

interface PendingGrant {
    readonly id: string
    readonly token: string
    readonly expiresAt: number
    readonly input: WriteGrantInput
    readonly gridFsId: mongoose.Types.ObjectId
}

/**
 * Read-only view of a pending grant exposed to the HTTP `/upload` endpoint
 * for token validation and byte-budget enforcement, without leaking the full
 * `WriteGrantInput`.
 */
export interface GridFsGrantPeek {
    readonly token: string
    readonly expiresAt: number
    readonly maxBytes: number
    readonly gridFsId: mongoose.Types.ObjectId
}

export interface GridFsBackendOptions {
    conn: mongoose.Connection
    hubPublicBaseUrl: string
}

/**
 * `IFileBackend` over a mongoose-managed GridFS bucket.
 *
 * Issues a one-shot bearer-token grant; the actual byte upload is handled by
 * `makeGridFsUploadEndpoint()` (see `./upload-endpoint`), which calls back into
 * `peekGrant`/`completeWrite` to finalise the metadata record.
 */
export class GridFsBackend implements IFileBackend {
    readonly name = 'gridfs'
    private readonly bucket: mongoose.mongo.GridFSBucket
    private readonly grants = new Map<string, PendingGrant>()

    constructor(private readonly opts: GridFsBackendOptions) {
        if (!opts.conn.db) {
            throw new Error('GridFsBackend requires an open mongoose connection')
        }
        this.bucket = new mongoose.mongo.GridFSBucket(opts.conn.db)
    }

    peekGrant(grantId: string): GridFsGrantPeek | null {
        const g = this.grants.get(grantId)
        if (!g) return null
        return {
            token: g.token,
            expiresAt: g.expiresAt,
            maxBytes: g.input.maxBytes,
            gridFsId: g.gridFsId,
        }
    }

    async issueWriteGrant(input: WriteGrantInput): Promise<WriteGrant> {
        const grantId = randomBytes(16).toString('hex')
        const token = randomBytes(32).toString('hex')
        const gridFsId = new mongoose.Types.ObjectId()
        const expiresAt = Date.now() + GRANT_TTL_MS

        this.grants.set(grantId, { id: grantId, token, expiresAt, input, gridFsId })

        const prospective: FileHandle = {
            fileId: gridFsId.toHexString(),
            backend: this.name,
            size: 0,
            name: input.name,
            mime: input.mime,
            permanent: input.permanent,
        }
        return {
            grantId,
            uploadUrl: `${this.opts.hubPublicBaseUrl}/upload?grant=${grantId}`,
            token,
            expiresAt,
            prospective,
        }
    }

    async completeWrite(grantId: string, actualBytes: number): Promise<FileHandle> {
        const grant = this.grants.get(grantId)
        if (!grant) throw new Error(`no such grant: ${grantId}`)
        if (grant.expiresAt < Date.now()) {
            this.grants.delete(grantId)
            throw new Error(`grant expired: ${grantId}`)
        }

        const ttl = grant.input.permanent
            ? null
            : new Date(Date.now() + (grant.input.ttlSeconds || DEFAULT_TTL_SEC) * 1000)

        await FileMetadataModel.create({
            gridFsId:  grant.gridFsId,
            sessionId: grant.input.sessionId ?? null,
            nodeId:    grant.input.nodeId ?? null,
            permanent: grant.input.permanent,
            expiresAt: ttl,
            name:      grant.input.name,
            mime:      grant.input.mime,
            size:      actualBytes,
        })

        this.grants.delete(grantId)
        return {
            fileId:    grant.gridFsId.toHexString(),
            backend:   this.name,
            size:      actualBytes,
            name:      grant.input.name,
            mime:      grant.input.mime,
            permanent: grant.input.permanent,
        }
    }

    async *read(handle: FileHandle): AsyncIterable<Buffer> {
        const id = new mongoose.Types.ObjectId(handle.fileId)
        const stream = this.bucket.openDownloadStream(id)
        for await (const chunk of stream) {
            yield Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        }
    }

    async stat(handle: FileHandle): Promise<FileHandle> {
        const meta = await FileMetadataModel.findOne({
            gridFsId: new mongoose.Types.ObjectId(handle.fileId),
        }).lean()
        if (!meta) throw new Error(`unknown file: ${handle.fileId}`)
        return {
            fileId:    handle.fileId,
            backend:   this.name,
            size:      meta.size,
            name:      meta.name,
            mime:      meta.mime,
            permanent: meta.permanent,
        }
    }

    async delete(handle: FileHandle): Promise<void> {
        const id = new mongoose.Types.ObjectId(handle.fileId)
        await this.bucket.delete(id).catch(() => undefined)
        await FileMetadataModel.deleteOne({ gridFsId: id })
    }
}
