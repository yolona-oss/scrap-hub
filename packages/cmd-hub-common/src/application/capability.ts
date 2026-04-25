/**
 * Typed capability registry for Application. Middlewares `provide` keys,
 * consumers `get` them. Keys are plain strings at runtime (stored in
 * `app.context`); the phantom `__value` field carries the payload type.
 *
 * Convention: dotted namespaces, e.g. `'transport.manifestAggregator'`.
 */

export type CapabilityKey<Value> = string & {
    readonly __brand: 'CapabilityKey'
    readonly __value?: Value
}

/** Declare a typed capability key. */
export function defineCapability<Value>(name: string): CapabilityKey<Value> {
    return name as CapabilityKey<Value>
}

export interface ICapabilityRegistry {
    /** `providedBy` is metadata only; surfaces in `manifestSnapshot()`. */
    provide<V>(key: CapabilityKey<V>, value: V, providedBy?: string): void
    get<V>(key: CapabilityKey<V>): V | undefined
    revoke<V>(key: CapabilityKey<V>): void
    has<V>(key: CapabilityKey<V>): boolean
}

/** Read a capability that MUST be present, with an actionable error message. */
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
