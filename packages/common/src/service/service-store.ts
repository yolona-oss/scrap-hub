/**
 * Narrow persistence interface for {@link BaseCommandService}.
 *
 * The store exposes a layered model: an **account layer** carries the
 * baseline config that survives across all sessions for a given account,
 * and an optional **session layer** acts as an overlay on top that the
 * running service writes to. Reads merge `account ← session ← input`;
 * writes default to the session layer (so the account baseline stays
 * stable). The `/sconfig` built-in writes to the account layer for
 * persistent updates.
 *
 * Naming convention (mongoose layer mapping):
 * - `IServiceAccountLayer.data` corresponds to `account_module.data`
 *   (the per-account baseline).
 * - `IServiceSessionLayer.data` corresponds to
 *   `account_module_session.data` (the optional overlay; inherits from
 *   the account layer at read time).
 *
 * Concrete implementations (e.g. cmd-hub's mongoose-backed
 * `MongoServiceStore`) map this to their data layer. Moving this seam
 * out of the service class keeps `@cmd-hub/common` independent of
 * `@core/db`.
 */
export interface IServiceAccountLayer {
    /** Current snapshot of the account-module's `data` subtree. Callers must not mutate in place — use setField. */
    readonly data: Record<string, unknown>
    /** Persist a path-update on the account-module doc. Path is dot-separated, e.g. "config.query". Pass '' to replace the full object at key. */
    setField(path: string, value: unknown): Promise<void>
    /** Replace the full `data.config` object and save. */
    replaceConfig(config: Record<string, unknown>): Promise<void>
}

export interface IServiceSessionLayer {
    /** Resolved session name. */
    readonly name: string
    /** Current snapshot of the session's `data` subtree. */
    readonly data: Record<string, unknown>
    setField(path: string, value: unknown): Promise<void>
    replaceData(data: Record<string, unknown>): Promise<void>
}

export interface IServiceStoreLoadResult {
    accountLayer: IServiceAccountLayer
    sessionLayer: IServiceSessionLayer
}

export interface IServiceStore {
    /**
     * Get-or-create the account-layer + session-layer for this
     * (userId, serviceName, desiredSessionId) triple. The store creates
     * the default session if it doesn't exist.
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
