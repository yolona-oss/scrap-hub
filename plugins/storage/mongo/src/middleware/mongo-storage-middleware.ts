import { z } from 'zod'
import {
    IAppMiddleware,
    ConfigContributor,
    AppLike,
    Phase,
    readConfigSlice,
    CAP_StorageConnection,
    CAP_SystemConfigRepo,
    CAP_UserConfigRepo,
    CAP_NodeRecordRepo,
    CAP_ManagerRepo,
    CAP_AccountRepo,
    CAP_InvitationLinkRepo,
    CAP_CmdAliasRepo,
    CAP_PendingDeleteRepo,
    CAP_ServiceStore,
    CAP_SessionLogRepo,
} from '@cmd-hub/common'
import { MongooseStorageConnection } from '../connection'
import { MongoSystemConfigRepo } from '../repos/system-config.repo'
import { MongoUserConfigRepo } from '../repos/user-config.repo'
import { MongoNodeRecordRepo } from '../repos/node-record.repo'
import { MongoManagerRepo } from '../repos/manager.repo'
import { MongoAccountRepo } from '../repos/account.repo'
import { MongoInvitationLinkRepo } from '../repos/invitation-link.repo'
import { MongoCmdAliasRepo } from '../repos/cmd-alias.repo'
import { MongoPendingDeleteRepo } from '../repos/pending-delete.repo'
import { MongoServiceStore } from '../repos/service-store'
import { MongoSessionLogRepo } from '../repos/session-log.repo'

export const MongoStorageConfigSchema = z.object({
    url: z.string().min(1),
})

export type MongoStorageConfig = z.infer<typeof MongoStorageConfigSchema>

/**
 * Connects mongoose during the Storage phase and publishes every Mongo-backed
 * repo atomically.
 *
 * Capability output:
 *   CAP_StorageConnection   — `IMongoStorageConnection` (lifecycle + mongoose handle)
 *   CAP_SystemConfigRepo    — singleton-scoped config rows
 *   CAP_UserConfigRepo      — per-user config rows
 *   CAP_NodeRecordRepo      — registered cmd-node persistence
 *   CAP_ManagerRepo         — Manager + companion Account creation, mutations
 *   CAP_AccountRepo         — Account + module + session aggregate access
 *   CAP_InvitationLinkRepo  — web-flow invitation tokens
 *   CAP_CmdAliasRepo        — per-Manager command aliases
 *   CAP_PendingDeleteRepo   — message-lifecycle persistence
 *   CAP_ServiceStore        — `BaseCommandService` session store
 *   CAP_SessionLogRepo      — append-only UiMessage history per session
 *
 * Plugins that need richer mongoose access (registering their own schema, GridFS
 * bucket, etc.) read `app.get(CAP_StorageConnection)` and `narrowToMongo()` it.
 */
export class MongoStorageMiddleware implements IAppMiddleware, ConfigContributor {
    readonly name = 'MongoStorageMiddleware'
    readonly phase = Phase.Storage
    readonly namespace = 'storage'
    readonly schema = MongoStorageConfigSchema

    private connection: MongooseStorageConnection | null = null

    async install(app: AppLike): Promise<void> {
        const cfg = readConfigSlice(app, this)
        this.connection = new MongooseStorageConnection(cfg.url)
        await this.connection.connect()

        app.provide(CAP_StorageConnection, this.connection)
        app.provide(CAP_SystemConfigRepo, new MongoSystemConfigRepo())
        app.provide(CAP_UserConfigRepo, new MongoUserConfigRepo())
        app.provide(CAP_NodeRecordRepo, new MongoNodeRecordRepo())
        app.provide(CAP_ManagerRepo, new MongoManagerRepo())
        app.provide(CAP_AccountRepo, new MongoAccountRepo())
        app.provide(CAP_InvitationLinkRepo, new MongoInvitationLinkRepo())
        app.provide(CAP_CmdAliasRepo, new MongoCmdAliasRepo())
        app.provide(CAP_PendingDeleteRepo, new MongoPendingDeleteRepo())
        app.provide(CAP_ServiceStore, new MongoServiceStore())
        app.provide(CAP_SessionLogRepo, new MongoSessionLogRepo())
    }

    async uninstall(app: AppLike): Promise<void> {
        app.revoke(CAP_SessionLogRepo)
        app.revoke(CAP_ServiceStore)
        app.revoke(CAP_PendingDeleteRepo)
        app.revoke(CAP_CmdAliasRepo)
        app.revoke(CAP_InvitationLinkRepo)
        app.revoke(CAP_AccountRepo)
        app.revoke(CAP_ManagerRepo)
        app.revoke(CAP_NodeRecordRepo)
        app.revoke(CAP_UserConfigRepo)
        app.revoke(CAP_SystemConfigRepo)
        app.revoke(CAP_StorageConnection)
        if (this.connection) {
            await this.connection.disconnect()
            this.connection = null
        }
    }
}
