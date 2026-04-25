import { z } from 'zod'
import express from 'express'
import type { Server } from 'http'
import {
    IAppMiddleware,
    ConfigContributor,
    AppLike,
    Phase,
    readConfigSlice,
    requireCap,
    CAP_StorageConnection,
    CAP_FileBackend,
    CAP_FileMetadataRepo,
    defineCapability,
} from '@cmd-hub/common'
import { narrowToMongo } from '../connection'
import { GridFsBackend } from '../files/gridfs-backend'
import { makeGridFsUploadEndpoint } from '../files/upload-endpoint'
import { MongoFileMetadataRepo } from '../repos/file-metadata.repo'

/** Bound address of the local upload HTTP server. Mirrors the legacy
 *  `CAP_UploadBoundAddress` from `@cmd-hub/transport`; published here so
 *  the upload server lives next to the GridFS backend that drives it. */
export const CAP_GridFsUploadBoundAddress = defineCapability<string>('storageMongo.gridfsUploadBoundAddress')

export const GridFsStorageConfigSchema = z.object({
    /** Public URL the issued grants reference. e.g. `https://hub.example.com`. */
    publicBaseUrl: z.string().min(1),
    /** Local bind for the HTTP upload endpoint. e.g. `127.0.0.1:8081` or
     *  `127.0.0.1:0` to let the kernel pick a port (handy for tests). */
    bindAddress: z.string().min(1),
})

export type GridFsStorageConfig = z.infer<typeof GridFsStorageConfigSchema>

/**
 * Stands up the GridFS-backed `IFileBackend` and the matching HTTP `/upload`
 * endpoint. Runs in `Phase.Storage + 1` so it sees the live mongoose
 * connection published by `MongoStorageMiddleware`.
 *
 * Capability output:
 *   CAP_FileBackend                 — the GridFsBackend
 *   CAP_FileMetadataRepo            — Mongo metadata repo (TTL sweeps, sessions cleanup)
 *   CAP_GridFsUploadBoundAddress    — actual `host:port` of the upload server
 */
export class GridFsStorageMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'GridFsStorageMiddleware'
    readonly phase = (Phase.Storage + 1) as Phase
    readonly namespace = 'gridfs'
    readonly schema = GridFsStorageConfigSchema

    private server: Server | null = null

    async install(app: AppLike): Promise<void> {
        const cfg = readConfigSlice(app, this)
        const conn = narrowToMongo(requireCap(
            app, CAP_StorageConnection,
            'GridFsStorageMiddleware needs MongoStorageMiddleware (or another mongodb provider) before it',
        ))

        const backend = new GridFsBackend({
            conn: conn.connection,
            hubPublicBaseUrl: cfg.publicBaseUrl,
        })

        const router = makeGridFsUploadEndpoint({
            fileBackend: backend,
            grantSource: backend,
            conn: conn.connection,
        })
        const httpApp = express()
        httpApp.use(router)

        const [host, portStr] = cfg.bindAddress.split(':')
        const port = Number(portStr)

        const boundAddress = await new Promise<string>((resolve, reject) => {
            const srv = httpApp.listen(port, host, () => {
                this.server = srv
                resolve(this.resolveBoundAddress(srv, host))
            })
            srv.once('error', reject)
        })

        app.provide(CAP_FileBackend, backend)
        app.provide(CAP_FileMetadataRepo, new MongoFileMetadataRepo())
        app.provide(CAP_GridFsUploadBoundAddress, boundAddress)
    }

    async uninstall(app: AppLike): Promise<void> {
        const srv = this.server
        if (srv) {
            await new Promise<void>((resolve) => srv.close(() => resolve()))
            this.server = null
        }
        app.revoke(CAP_GridFsUploadBoundAddress)
        app.revoke(CAP_FileMetadataRepo)
        app.revoke(CAP_FileBackend)
    }

    private resolveBoundAddress(srv: Server, host: string): string {
        const addr = srv.address()
        if (addr && typeof addr === 'object') {
            return `${host}:${addr.port}`
        }
        return host
    }
}
