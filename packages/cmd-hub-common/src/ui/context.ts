/**
 * Minimal shape the UI layer needs from whatever "manager" entity the app uses.
 * Mirrors the public `ManagerRecord` shape (id is a string; no mongoose
 * leakage). UIs can extend this generic with their own fields if needed.
 */
export interface IBaseUIContextManager {
    /** String primary-key. For Mongo this is the hex of `_id`; future backends
     *  use whatever string id makes sense. */
    id: string
    userId: number | string
    isAdmin?: boolean
    messageWidth?: number | null
}

/**
 * Per-dispatch context handed to command handlers. Generic in the manager type
 * so downstream codebases can substitute their own IManager-compatible shape
 * without forcing @cmd-hub/common to depend on a data layer.
 */
export abstract class BaseUIContext<ManagerT extends IBaseUIContextManager = IBaseUIContextManager> {
    /** Short identity tag declared by the concrete UI (e.g. `"telegram"`). */
    abstract type: string
    abstract manager: ManagerT
    abstract reply: (...args: any) => Promise<any>
}
