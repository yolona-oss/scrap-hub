/**
 * Typed capability registry for Application.
 *
 * Middlewares publish capabilities (e.g. the gRPC server's ManifestAggregator)
 * via `app.provide(key, value)`. Consumers read them via `app.get(key)`.
 * The key's phantom type parameter pins the payload type so consumers
 * don't need `as` casts.
 *
 * Keys are plain strings at runtime (stored in `app.context`), so:
 *   - test harnesses can poke raw keys without importing the typed constant
 *   - the key name is what shows up in error messages
 *   - declarations don't add runtime cost
 *
 * Convention: key names use dotted namespaces, e.g.
 * `'transport.manifestAggregator'`, `'transport.nodeChannelResolver'`,
 * to avoid accidental collisions between packages.
 */

/** Branded string that carries its payload type as a phantom field. The
 *  field never exists at runtime — `defineCapability` returns the plain
 *  key name cast to this shape. The phantom `__value` property lets TS
 *  infer `Value` when the key appears as an argument. */
export type CapabilityKey<Value> = string & {
    readonly __brand: 'CapabilityKey'
    readonly __value?: Value
}

/**
 * Declare a capability key. The `Value` type parameter is carried through
 * the returned brand so `app.get(key)` returns `Value | undefined`.
 *
 *     const K_Aggregator = defineCapability<ManifestAggregator>('transport.manifestAggregator')
 *     app.provide(K_Aggregator, agg)
 *     const a: ManifestAggregator | undefined = app.get(K_Aggregator)
 */
export function defineCapability<Value>(name: string): CapabilityKey<Value> {
    return name as CapabilityKey<Value>
}

/**
 * The registry surface mixed into `AppLike`. Every Application instance
 * implements these against its private `context` bag.
 */
export interface ICapabilityRegistry {
    provide<V>(key: CapabilityKey<V>, value: V): void
    get<V>(key: CapabilityKey<V>): V | undefined
    /** Idempotent remove; primarily used by middleware uninstall. */
    revoke<V>(key: CapabilityKey<V>): void
    /** Runtime check. Returns true if the capability was provided and
     *  hasn't been revoked. */
    has<V>(key: CapabilityKey<V>): boolean
}

/**
 * Read a capability that MUST be present. Used by middlewares whose `install`
 * depends on something a previous middleware was supposed to publish — fails
 * with a clear, actionable message when the wiring is wrong.
 *
 *     const repo = requireCap(app, CAP_SystemConfigRepo,
 *         'ConfigBootMiddleware needs a storage middleware before it')
 *
 * Prefer this over `app.get(...)!` so the failure mode is "explicit error at
 * install time" rather than "undefined later in normal operation".
 */
export function requireCap<V>(
    registry: ICapabilityRegistry,
    key: CapabilityKey<V>,
    contextHint?: string,
): V {
    const value = registry.get(key)
    if (value === undefined) {
        const hint = contextHint ? ` — ${contextHint}` : ''
        throw new Error(`Required capability "${key}" not provided${hint}`)
    }
    return value
}
