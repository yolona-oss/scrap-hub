import type { z } from 'zod'
import type { Phase } from './phase'

/**
 * Minimal app-like contract middlewares receive on install/uninstall.
 * Avoids a circular import on Application.
 *
 * `context` is a shared mutable bag middlewares use to publish capabilities
 * to the rest of the app (e.g. `ProxyMiddleware` publishes `context.httpAgent`).
 * Keys should be unique across middlewares; no runtime collision detection
 * is enforced yet — if that becomes a problem, graduate this to a typed
 * capability registry.
 */
export interface AppLike {
    readonly config: unknown
    readonly context: Record<string, unknown>
}

export interface IAppMiddleware {
    readonly name?: string
    readonly phase: Phase
    install(app: AppLike): Promise<void> | void
    uninstall?(app: AppLike): Promise<void> | void
}

export type AppMiddleware =
    | IAppMiddleware
    | ((app: AppLike) => Promise<void | (() => Promise<void> | void)> | void | (() => Promise<void> | void))

export interface ConfigContributor {
    readonly namespace: string
    readonly schema: z.ZodType<unknown>
}

export function isConfigContributor(x: unknown): x is ConfigContributor {
    return typeof x === 'object' && x !== null &&
        typeof (x as ConfigContributor).namespace === 'string' &&
        typeof (x as ConfigContributor).schema === 'object' &&
        (x as ConfigContributor).schema !== null
}
