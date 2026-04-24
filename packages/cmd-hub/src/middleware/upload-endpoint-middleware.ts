import { z } from 'zod'
import mongoose from 'mongoose'
import express from 'express'
import type { Server } from 'http'
import { IAppMiddleware, ConfigContributor, Phase, AppLike } from '@cmd-hub/common'
import {
    makeUploadEndpoint,
    type FileService,
    type GridFSBackend,
} from '@cmd-hub/transport'

/**
 * Stands up the HTTP upload endpoint for GridFS-backed write grants.
 *
 * Depends on `_fileService` and `_gridfsBackend` having been installed
 * on the app by `GrpcServerMiddleware` earlier in the Transport phase.
 *
 * Contributed config:
 *   upload.bindAddress: string   — e.g. "127.0.0.1:8081"
 */
export class UploadEndpointMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'UploadEndpointMiddleware'
    readonly phase = Phase.Transport
    readonly namespace = 'upload'
    readonly schema = z.object({
        bindAddress: z.string().min(1),
    })

    private _server: Server | null = null

    async install(app: AppLike): Promise<void> {
        const cfg = (app.config as { upload: { bindAddress: string } }).upload
        const fileService = (app as any)._fileService as FileService | undefined
        const backend = (app as any)._gridfsBackend as GridFSBackend | undefined
        if (!fileService || !backend) {
            throw new Error(
                'UploadEndpointMiddleware requires _fileService and _gridfsBackend ' +
                'on the app — install GrpcServerMiddleware first',
            )
        }

        const router = makeUploadEndpoint({
            fileService,
            grantAccess: { peek: (id) => backend.peekGrant(id) },
            conn: mongoose.connection,
        })
        const httpApp = express()
        httpApp.use(router)

        const [host, portStr] = cfg.bindAddress.split(':')
        const port = Number(portStr)

        await new Promise<void>((resolve, reject) => {
            const srv = httpApp.listen(port, host, () => {
                this._server = srv
                ;(app as any)._uploadBoundAddress = this.resolveBoundAddress(srv, host)
                resolve()
            })
            srv.once('error', reject)
        })
    }

    async uninstall(_app: AppLike): Promise<void> {
        if (this._server) {
            await new Promise<void>((resolve) => this._server!.close(() => resolve()))
            this._server = null
        }
    }

    private resolveBoundAddress(srv: Server, host: string): string {
        const addr = srv.address()
        if (addr && typeof addr === 'object') {
            return `${host}:${addr.port}`
        }
        return host
    }
}
