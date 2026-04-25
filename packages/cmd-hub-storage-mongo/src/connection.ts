import mongoose from 'mongoose'
import type { IStorageConnection } from '@cmd-hub/common'

/**
 * Mongoose-flavoured `IStorageConnection`. Plugins that explicitly need to
 * register their own mongoose schemas narrow `app.get(CAP_StorageConnection)`
 * down to this shape via `narrowToMongo()` so they can call
 * `conn.mongoose.model(...)` against the live connection.
 */
export interface IMongoStorageConnection extends IStorageConnection {
    readonly kind: 'mongodb'
    readonly mongoose: typeof mongoose
    readonly connection: mongoose.Connection
}

export function isMongoConnection(c: IStorageConnection): c is IMongoStorageConnection {
    return c.kind === 'mongodb'
}

/** Throw if the active storage connection isn't mongoose-backed. Used by
 *  plugins that register their own mongoose schema. */
export function narrowToMongo(c: IStorageConnection): IMongoStorageConnection {
    if (!isMongoConnection(c)) {
        throw new Error(
            `narrowToMongo: expected a mongodb storage connection, got "${c.kind}"`,
        )
    }
    return c
}

/**
 * Concrete `IMongoStorageConnection` backed by the global `mongoose` singleton.
 *
 * Why the global and not `mongoose.createConnection()`? Every `*.model.ts`
 * file in this package (and in `@cmd-hub/core/db/...`-style consumers) uses
 * `mongoose.model(...)`, which binds models to the default connection.
 * Switching this class to `createConnection()` would orphan every model
 * unless the entire model layer was refactored into factories that take a
 * connection argument — a large refactor that pays back nothing for the
 * one-Application-per-process deployment model the framework actually
 * targets.
 *
 * The honest constraint: at most one `MongooseStorageConnection` may be
 * `connect()`-ed at a time per process. The class enforces this with a
 * module-level lock that surfaces the violation immediately rather than
 * letting two instances clobber each other's `disconnect()` calls.
 *
 * Tests that need to drive multiple databases sequentially must
 * `disconnect()` between switches; that's how `mongodb-memory-server`-based
 * suites already work.
 */
let _activeInstance: MongooseStorageConnection | null = null

export class MongooseStorageConnection implements IMongoStorageConnection {
    readonly kind = 'mongodb' as const
    readonly mongoose = mongoose
    readonly connection: mongoose.Connection
    private _connected = false

    constructor(private readonly url: string) {
        this.connection = mongoose.connection
    }

    get isConnected(): boolean { return this._connected }

    async connect(): Promise<void> {
        if (this._connected) return
        if (_activeInstance && _activeInstance !== this) {
            throw new Error(
                'MongooseStorageConnection: another instance is already connected to ' +
                'mongoose in this process. The framework runs one Application per ' +
                'process; if you need multiple databases simultaneously, refactor ' +
                'your model layer to use mongoose.createConnection() per instance.',
            )
        }
        await mongoose.connect(this.url)
        _activeInstance = this
        this._connected = true
    }

    async disconnect(): Promise<void> {
        if (!this._connected) return
        await mongoose.disconnect()
        this._connected = false
        if (_activeInstance === this) {
            _activeInstance = null
        }
    }
}
