import type { BuiltInHandler } from '../dispatcher/hub-dispatcher'
import type { ManifestAggregator } from '../pool/manifest-aggregator'
import type { IAccountModuleStore } from './sconfig-store'

export interface SConfigBuiltInDeps {
    aggregator: ManifestAggregator
    store: IAccountModuleStore
}

/**
 * /sconfig                        — list modules known to any connected node
 * /sconfig <module>               — list current values for this user
 * /sconfig <module> <key>         — read one value
 * /sconfig <module> <key> <value> — write value (no fan-out; read per-invocation)
 */
export function makeSConfigBuiltIn(deps: SConfigBuiltInDeps): BuiltInHandler {
    return async (input) => {
        const module = input.args.module ?? ''
        const key = input.args.key ?? ''
        const value = input.args.value
        const userId = input.userId

        if (!module) {
            const modules = deps.aggregator.configModuleNames()
            const text = modules.length === 0
                ? 'no config modules registered by any node'
                : modules.join('\n')
            return { success: true, markup: { text }, messageType: 'system' }
        }

        const owners = deps.aggregator.configModuleOwners(module)
        if (owners.length === 0) {
            return { success: false, markup: { text: `no node owns config module: ${module}` } }
        }

        if (!key) {
            const values = await deps.store.list(userId, module)
            const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`)
            const text = lines.length === 0 ? `(no values set for ${module})` : lines.join('\n')
            return { success: true, markup: { text }, messageType: 'system' }
        }

        if (value === undefined) {
            const current = await deps.store.get(userId, module, key)
            const text = current === null ? `(unset)` : current
            return { success: true, markup: { text: `${module}.${key}=${text}` }, messageType: 'system' }
        }

        await deps.store.set(userId, module, key, value)
        return { success: true, markup: { text: `set ${module}.${key}` }, messageType: 'system' }
    }
}
