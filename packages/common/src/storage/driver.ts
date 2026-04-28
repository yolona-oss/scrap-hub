import type { IStorageConnection } from './types'
import type { INodeRecordRepo } from './repos'

/** Driver-specific config (Mongo URI, Postgres DSN, etc.). The driver
 *  module validates and consumes its own slice; `cmd-hub` treats it as
 *  opaque key/value at this layer. */
export type StorageDriverConfig = Record<string, unknown>

/** Minimum live state a storage driver provides at boot: a connection
 *  the framework can manage and the repos required before any
 *  middleware runs (currently just the node-record repo for the
 *  registry). Other repos arrive lazily via the per-middleware install
 *  hooks that consume `CAP_StorageConnection`. */
export interface StorageBootstrap {
    readonly connection: IStorageConnection
    readonly nodeRecord: INodeRecordRepo
}

/** Pluggable storage driver shape. Driver packages export one of these
 *  (default export OR a named `*Driver` export); the CLI / app loader
 *  resolves the package and calls `bootstrap()`. */
export interface StorageDriverModule {
    readonly driverName: string
    bootstrap(config: StorageDriverConfig): Promise<StorageBootstrap>
}
