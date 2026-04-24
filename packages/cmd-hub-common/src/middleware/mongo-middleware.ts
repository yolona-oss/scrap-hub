import mongoose from 'mongoose'
import { z } from 'zod'
import {
    IAppMiddleware,
    ConfigContributor,
    AppLike,
    readConfigSlice,
} from '../application/middleware-types'
import { Phase } from '../application/phase'

/** Shape of `@cmd-hub/core` that MongoMiddleware cares about. Lazy-required;
 *  unavailable in pure-common environments (e.g. node-only deployments). */
interface CoreModuleShape {
    ConfigRegistry?: { migrateToMongoDB?: () => Promise<void> }
}

/**
 * Connects mongoose during the Storage phase; disconnects on uninstall.
 *
 * Contributes a `mongo` namespace to the application config:
 *  - url: mongodb connection string
 *  - migrateConfigRegistry: when true, invokes @cmd-hub/core's ConfigRegistry
 *    migration. Safe to leave false in pure-common usage; the lookup is done
 *    via lazy `require` so common has no hard dependency on core.
 */
export class MongoMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'MongoMiddleware'
    readonly phase = Phase.Storage
    readonly namespace = 'mongo'
    readonly schema = z.object({
        url: z.string().min(1),
        migrateConfigRegistry: z.boolean().default(false),
    })

    async install(app: AppLike): Promise<void> {
        const cfg = readConfigSlice(app, this)
        await mongoose.connect(cfg.url)
        if (cfg.migrateConfigRegistry) {
            let core: CoreModuleShape | null = null
            try {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                core = require('@cmd-hub/core') as CoreModuleShape
            } catch (e: unknown) {
                // Swallow ONLY the not-installed case. Any other require error
                // (parse error, peer-dep missing, etc.) is a real bug and must
                // surface.
                const errno = e as NodeJS.ErrnoException | null
                if (errno?.code !== 'MODULE_NOT_FOUND') {
                    throw e
                }
            }
            if (core?.ConfigRegistry?.migrateToMongoDB) {
                await core.ConfigRegistry.migrateToMongoDB()
            }
        }
    }

    async uninstall(_app: AppLike): Promise<void> {
        // TODO(phase-4): this tears down the global mongoose singleton. If
        // two Application instances ever share the process, whichever one
        // uninstalls first kills the other's connection. Switch to
        // mongoose.createConnection(url).close() when that lands.
        await mongoose.disconnect()
    }
}
