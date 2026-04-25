/* eslint-disable no-console */
import 'reflect-metadata'
import { z } from 'zod'
import {
    ProxyMiddleware,
    AppLockMiddleware,
} from '@cmd-hub/common'
import {
    MongoStorageMiddleware,
    GridFsStorageMiddleware,
} from '@cmd-hub/storage-mongo'
import {
    CmdHubApp,
    GrpcServerMiddleware,
    CmdNodeClientMiddleware,
    ConfigBootMiddleware,
} from '@cmd-hub/core'
import { TelegramUI } from '@cmd-hub/ui-telegram'

/**
 * App-specific config slice. Each middleware + UI contributes its own
 * slice automatically (storage, gridfs, proxy, appLock, grpc, telegram).
 * `deployment` lets operators tag config.json with a human-readable name.
 */
const AppSchema = z.object({
    deployment: z.object({ name: z.string().default('default') }).default({}),
})

async function bootstrap() {
    const app = new CmdHubApp({
        configPath: process.argv[2] ?? './config.json',
        baseSchema: AppSchema,
    })
        .use(new AppLockMiddleware())
        .use(new ProxyMiddleware())
        .use(new MongoStorageMiddleware())
        .use(new GridFsStorageMiddleware())
        .use(new ConfigBootMiddleware())
        .use(new GrpcServerMiddleware({ insecure: true }))
        .use(new CmdNodeClientMiddleware())
        .useUI(new TelegramUI())

    await app.Initialize()
    await app.run()
    // Application's built-in SIGINT/SIGTERM handlers call terminate() on shutdown.
}

bootstrap().catch((e) => {
    console.error('[telegram-ui-app] fatal:', e)
    process.exit(1)
})
