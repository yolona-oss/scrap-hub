import type { AvailableUIsType } from './available-uis-type'

/**
 * Minimal shape the UI layer needs from whatever "manager" entity the app uses.
 * In cmd-hub the concrete `Manager` mongoose doc satisfies this automatically
 * because it declares `userId: number | string`.
 *
 * A handful of optional fields (`_id`, `isAdmin`, `messageWidth`) are exposed
 * here so the built-in dispatcher/command code can read them without requiring
 * every downstream consumer to narrow the generic. Concrete implementations are
 * free to provide them (mongoose docs do) or leave them undefined.
 */
export interface IBaseUIContextManager {
    userId: number | string
    /** Primary-key id on the underlying record. Typed loosely so mongoose's
     *  ObjectId (which has toString()) is assignable without common needing
     *  a mongoose type dep. */
    _id?: string | { toString(): string }
    isAdmin?: boolean
    messageWidth?: number
}

/**
 * Per-dispatch context handed to command handlers. Generic in the manager type
 * so downstream codebases can substitute their own IManager-compatible shape
 * without forcing @cmd-hub/common to depend on a data layer.
 */
export abstract class BaseUIContext<ManagerT extends IBaseUIContextManager = IBaseUIContextManager> {
    abstract type: AvailableUIsType
    abstract manager: ManagerT
    abstract reply: (...args: any) => Promise<any>
}
