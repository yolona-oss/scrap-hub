import { Router, type Request, type Response } from 'express'
import { timingSafeEqual } from 'crypto'
import mongoose from 'mongoose'
import type { IFileBackend } from '@cmd-hub/common'
import type { GridFsBackend } from './gridfs-backend'

export interface GridFsUploadEndpointDeps {
    /** The same `IFileBackend` instance published as `CAP_FileBackend`. The
     *  endpoint calls `completeWrite` once bytes are streamed to GridFS. */
    fileBackend: IFileBackend
    /** GridFS-specific grant peek for token validation. We need the concrete
     *  `GridFsBackend` here (not the abstract `IFileBackend`) because grant
     *  validation is GridFS-specific machinery. */
    grantSource: GridFsBackend
    /** Mongoose connection that owns the GridFS bucket. */
    conn: mongoose.Connection
}

const UNAUTHORIZED = 401
const EXPIRED = 410
const TOO_LARGE = 413
const NOT_FOUND = 404
const BAD_REQUEST = 400
const CREATED = 201

function parseBearerToken(header: string): string {
    const prefix = 'Bearer '
    if (!header.startsWith(prefix)) return ''
    return header.slice(prefix.length).trim()
}

/**
 * Constant-time UTF-8 string comparison. Returns false immediately on length
 * mismatch; otherwise compares via node's `timingSafeEqual` so a motivated
 * attacker can't learn byte-by-byte which prefix of the token matches via
 * response-time measurements.
 */
function constantTimeStringEq(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    const aBuf = Buffer.from(a, 'utf8')
    const bBuf = Buffer.from(b, 'utf8')
    if (aBuf.length !== bBuf.length) return false
    return timingSafeEqual(aBuf, bBuf)
}

export function makeGridFsUploadEndpoint(deps: GridFsUploadEndpointDeps): Router {
    const router = Router()
    const db = deps.conn.db
    if (!db) throw new Error('mongoose connection has no db')
    const bucket = new mongoose.mongo.GridFSBucket(db)

    router.put('/upload', (req: Request, res: Response) => {
        const grantId = typeof req.query.grant === 'string' ? req.query.grant : ''
        if (!grantId) {
            res.status(BAD_REQUEST).json({ error: 'missing grant query param' })
            return
        }
        const presentedToken = parseBearerToken(req.get('authorization') ?? '')
        const grant = deps.grantSource.peekGrant(grantId)
        if (!grant) {
            res.status(NOT_FOUND).json({ error: `no such grant: ${grantId}` })
            return
        }
        if (!constantTimeStringEq(presentedToken, grant.token)) {
            res.status(UNAUTHORIZED).json({ error: 'invalid upload token' })
            return
        }
        if (grant.expiresAt < Date.now()) {
            res.status(EXPIRED).json({ error: 'grant expired' })
            return
        }

        let written = 0
        let exceeded = false
        const uploadStream = bucket.openUploadStreamWithId(grant.gridFsId, `upload-${grantId}`)

        req.on('data', (chunk: Buffer) => {
            if (exceeded) return
            written += chunk.length
            if (written > grant.maxBytes) {
                exceeded = true
                uploadStream.destroy(new Error(`exceeded maxBytes ${grant.maxBytes}`))
            } else {
                uploadStream.write(chunk)
            }
        })

        req.on('end', () => {
            if (exceeded) return
            uploadStream.end()
        })

        uploadStream.on('finish', async () => {
            if (exceeded) return
            try {
                const handle = await deps.fileBackend.completeWrite(grantId, written)
                res.status(CREATED).json({ handle })
            } catch (err) {
                // Log internal message server-side but return a generic 400 so
                // the endpoint doesn't leak backend error shapes to untrusted
                // callers. Pass grantId as a log argument (not inside the
                // format string) to prevent log-injection via CRLF or format
                // specifiers embedded in the grant id. Also strip newlines
                // defensively in case the log backend ignores argument form.
                const safeGrantId = String(grantId).replace(/[\r\n]/g, '')
                // eslint-disable-next-line no-console
                console.error('[upload] completeWrite failed for grant %s:', safeGrantId, err)
                res.status(BAD_REQUEST).json({ error: 'upload finalization rejected' })
            }
        })

        uploadStream.on('error', () => {
            if (exceeded) {
                res.status(TOO_LARGE).json({ error: `exceeded maxBytes ${grant.maxBytes}` })
            } else {
                res.status(BAD_REQUEST).json({ error: 'upload failed' })
            }
        })

        req.on('error', () => {
            if (!res.headersSent) res.status(BAD_REQUEST).json({ error: 'request error' })
        })
    })

    return router
}
