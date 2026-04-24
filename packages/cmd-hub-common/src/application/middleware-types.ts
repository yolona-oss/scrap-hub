import type { z } from 'zod'
import type { Phase } from './phase'
import type { ICapabilityRegistry } from './capability'

/**
 * Minimal app-like contract middlewares receive on install/uninstall.
 * Avoids a circular import on Application.
 *
 * `context` is a legacy shared mutable bag middlewares used to use for
 * capability publication (e.g. `ProxyMiddleware` set `context.httpAgent`).
 * New code should prefer the typed capability registry
 * (`app.provide(key, value)` + `app.get(key)`), which backs onto `context`
 * under the hood but enforces payload types.
 */
export interface AppLike extends ICapabilityRegistry {
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
