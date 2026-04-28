/** A live connection to a storage backend (e.g., a Mongo client). The
 *  driver module's `bootstrap()` returns one of these alongside its
 *  initial repos so middleware can manage the lifecycle. */
export interface IStorageConnection {
    readonly kind: string
    readonly isConnected: boolean
    connect(): Promise<void>
    disconnect(): Promise<void>
}
