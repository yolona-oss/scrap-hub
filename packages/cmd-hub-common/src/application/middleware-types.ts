import { z } from 'zod'
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
    if (typeof x !== 'object' || x === null) return false
    const rec = x as Record<string, unknown>
    return typeof rec.namespace === 'string' &&
        typeof rec.schema === 'object' &&
        rec.schema !== null
}

/**
 * Read a ConfigContributor's own slice off the validated `app.config`.
 * Consumers typed as `Schema extends z.ZodType<unknown>` get `z.infer<Schema>`
 * back — no hand-maintained inline `{ foo: string }` type, no `as any`.
 *
 * Middlewares call this inside `install(app)`:
 *
 *     async install(app: AppLike) {
 *         const cfg = readConfigSlice(app, this)
 *         cfg.url // fully typed from the contributor's own zod schema
 *     }
 *
 * The function re-validates the slice through the contributor's own schema
 * so zod's defaults/transforms land consistently even if the merged schema
 * was widened elsewhere.
 */
export function readConfigSlice<C extends ConfigContributor>(
    app: AppLike,
    contributor: C,
): z.infer<C['schema']> {
    const rawConfig = app.config
    if (typeof rawConfig !== 'object' || rawConfig === null) {
        throw new Error(
            `readConfigSlice: app.config is not an object; cannot read slice ` +
            `"${contributor.namespace}" (got ${typeof rawConfig})`,
        )
    }
    const slice = (rawConfig as Record<string, unknown>)[contributor.namespace]
    return contributor.schema.parse(slice) as z.infer<C['schema']>
}
