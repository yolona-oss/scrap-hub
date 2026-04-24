/* eslint-disable no-console */
import 'reflect-metadata'
import { z } from 'zod'
import {
    MongoMiddleware,
    ProxyMiddleware,
    AppLockMiddleware,
} from '@cmd-hub/common'
import {
    CmdHubApp,
    GrpcServerMiddleware,
    UploadEndpointMiddleware,
    CmdNodeClientMiddleware,
} from '@cmd-hub/core'
import { TelegramUI } from '@cmd-hub/ui-telegram'

/**
 * App-specific config slice. Each middleware + UI contributes its own
 * slice automatically (mongo, proxy, appLock, grpc, upload, telegram).
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
        .use(new MongoMiddleware())
        .use(new GrpcServerMiddleware())
        .use(new UploadEndpointMiddleware())
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
