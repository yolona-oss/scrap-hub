/**
 * Narrow persistence interface for {@link BaseCommandService}.
 *
 * Concrete implementations (e.g. cmd-hub's mongoose-backed `MongoServiceStore`)
 * map this to their data layer. Moving this seam out of the service class keeps
 * `@cmd-hub/common` independent of `@core/db`.
 *
 * Naming convention:
 * - `moduleData` corresponds to the per-service record on an account
 *   (`account_module.data` in the mongoose layer).
 * - `sessionData` is the per-session record hanging off the module
 *   (`account_module_session.data`).
 */
export interface IServiceModuleHandle {
    /** Current snapshot of the module's `data` subtree. Callers must not mutate in place — use setField. */
    readonly data: Record<string, unknown>
    /** Persist a path-update on the module doc. Path is dot-separated, e.g. "config.query". Pass '' to replace the full object at key. */
    setField(path: string, value: unknown): Promise<void>
    /** Replace the full `data.config` object and save. */
    replaceConfig(config: Record<string, unknown>): Promise<void>
}

export interface IServiceSessionHandle {
    /** Resolved session name. */
    readonly name: string
    /** Current snapshot of the session's `data` subtree. Mirror `data` field above. */
    readonly data: Record<string, unknown>
    setField(path: string, value: unknown): Promise<void>
    replaceData(data: Record<string, unknown>): Promise<void>
}

export interface IServiceStoreLoadResult {
    module: IServiceModuleHandle
    session: IServiceSessionHandle
}

export interface IServiceStore {
    /**
     * Get-or-create the module + session for this (userId, serviceName, desiredSessionId) triple.
     * The store is responsible for creating the default session if it doesn't exist.
     *
     * @param defaultExpirityMs expirity for new sessions; ignored if the session already exists.
     * @param incrementalExpirity whether expirity auto-extends on use; ignored if session exists.
     */
    load(input: {
        userId: string
        serviceName: string
        desiredSessionId: string
        defaultExpirityMs: number
        incrementalExpirity: boolean
    }): Promise<IServiceStoreLoadResult>
}

export const DEFAULT_ACCOUNT_SESSION_NAME = "default_session"
export const DEFAULT_SESSION_EXPIRITY_MS = 86_400_000  // 1 day
