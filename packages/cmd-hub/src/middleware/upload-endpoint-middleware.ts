import { z } from 'zod'
import mongoose from 'mongoose'
import express from 'express'
import type { Server } from 'http'
import {
    IAppMiddleware,
    ConfigContributor,
    Phase,
    AppLike,
    readConfigSlice,
} from '@cmd-hub/common'
import {
    makeUploadEndpoint,
    CAP_FileService,
    CAP_GridFSBackend,
    CAP_UploadBoundAddress,
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
        const cfg = readConfigSlice(app, this)
        const fileService = app.get(CAP_FileService)
        const backend = app.get(CAP_GridFSBackend)
        if (!fileService || !backend) {
            throw new Error(
                'UploadEndpointMiddleware requires CAP_FileService and CAP_GridFSBackend ' +
                'provided by an earlier middleware (install GrpcServerMiddleware first)',
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
                app.provide(CAP_UploadBoundAddress, this.resolveBoundAddress(srv, host))
                resolve()
            })
            srv.once('error', reject)
        })
    }

    async uninstall(app: AppLike): Promise<void> {
        const srv = this._server
        if (srv) {
            await new Promise<void>((resolve) => srv.close(() => resolve()))
            this._server = null
        }
        app.revoke(CAP_UploadBoundAddress)
    }

    private resolveBoundAddress(srv: Server, host: string): string {
        const addr = srv.address()
        if (addr && typeof addr === 'object') {
            return `${host}:${addr.port}`
        }
        return host
    }
}
