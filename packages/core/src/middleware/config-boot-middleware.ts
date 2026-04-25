import {
    AppLike,
    IAppMiddleware,
    Phase,
    requireCap,
    CAP_SystemConfigRepo,
    CAP_UserConfigRepo,
} from '@cmd-hub/common'
import { ConfigRegistry } from '../config-registry'

/**
 * Wires the static `ConfigRegistry` to the live system/user-config repos and
 * seeds first-run defaults for every registered non-bootstrap module. Runs
 * after the storage middleware (Phase.Storage + 2) so the repos are already
 * published.
 */
export class ConfigBootMiddleware implements IAppMiddleware {
    readonly name = 'ConfigBootMiddleware'
    readonly phase = (Phase.Storage + 2) as Phase

    async install(app: AppLike): Promise<void> {
        const sys = requireCap(
            app, CAP_SystemConfigRepo,
            'ConfigBootMiddleware needs a storage middleware before it (e.g. MongoStorageMiddleware)',
        )
        const user = requireCap(
            app, CAP_UserConfigRepo,
            'ConfigBootMiddleware needs a storage middleware before it (e.g. MongoStorageMiddleware)',
        )
        ConfigRegistry.attachRepos(sys, user)
        await ConfigRegistry.seedSystemDefaults()
    }
}
