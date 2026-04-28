/**
 * `StorageDriverModule` export consumed by `@cmd-hub/cli`. The CLI
 * imports this package by name (no static `import` from the framework
 * side) and calls `mongoDriver.bootstrap(config)` to get a connected
 * `IStorageConnection` plus the repos it needs.
 */

import type { StorageDriverModule, StorageBootstrap, StorageDriverConfig } from '@cmd-hub/common'
import { MongooseStorageConnection } from './connection'
import { MongoNodeRecordRepo } from './repos/node-record.repo'
import { NodeRecordModel } from './models/node-record.model'

async function bootstrap(config: StorageDriverConfig): Promise<StorageBootstrap> {
    const url = typeof config.url === 'string' ? config.url : ''
    if (!url) {
        throw new Error('@cmd-hub/storage-mongo: storage config must include a string `url` field')
    }
    const connection = new MongooseStorageConnection(url)
    await connection.connect()
    await NodeRecordModel.init()
    return {
        connection,
        nodeRecord: new MongoNodeRecordRepo(),
    }
}

export const mongoDriver: StorageDriverModule = {
    driverName: 'mongo',
    bootstrap,
}
