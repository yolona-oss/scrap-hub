import type { BuiltInHandler } from '../dispatcher/hub-dispatcher'
import type { ManifestAggregator } from '../pool/manifest-aggregator'
import type { ISystemConfigStore } from './config-store'

export type ConfigReloadCallback = (nodeId: string, module: string) => Promise<void>

export interface ConfigBuiltInDeps {
    aggregator: ManifestAggregator
    store: ISystemConfigStore
    configReload: ConfigReloadCallback
}

/**
 * /config                        — list modules known to any connected node
 * /config <module>               — list current values for that module
 * /config <module> <key>         — read one value
 * /config <module> <key> <value> — write value, fan out ConfigReload to owners
 */
export function makeConfigBuiltIn(deps: ConfigBuiltInDeps): BuiltInHandler {
    return async (input) => {
        const module = input.args.module ?? ''
        const key = input.args.key ?? ''
        const value = input.args.value

        if (!module) {
            const modules = deps.aggregator.configModuleNames()
            const text = modules.length === 0
                ? 'no config modules registered by any node'
                : modules.map((m) => {
                    const owners = deps.aggregator.configModuleOwners(m).join(', ')
                    return `${m} (owners: ${owners})`
                }).join('\n')
            return { success: true, markup: { text }, messageType: 'system' }
        }

        if (!key) {
            const owners = deps.aggregator.configModuleOwners(module)
            if (owners.length === 0) {
                return { success: false, markup: { text: `no node owns config module: ${module}` } }
            }
            const values = await deps.store.list(module)
            const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`)
            const text = lines.length === 0 ? `(no values set for ${module})` : lines.join('\n')
            return { success: true, markup: { text }, messageType: 'system' }
        }

        if (value === undefined) {
            const current = await deps.store.get(module, key)
            const text = current === null ? `(unset)` : current
            return { success: true, markup: { text: `${module}.${key}=${text}` }, messageType: 'system' }
        }

        // Write + fan-out
        const owners = deps.aggregator.configModuleOwners(module)
        if (owners.length === 0) {
            return { success: false, markup: { text: `no node owns config module: ${module}` } }
        }
        await deps.store.set(module, key, value)
        for (const nodeId of owners) {
            try {
                await deps.configReload(nodeId, module)
            } catch {
                // A failed reload is non-fatal; surface it in the response text below.
            }
        }
        return {
            success: true,
            markup: { text: `set ${module}.${key}; reloaded ${owners.length} node(s)` },
            messageType: 'system',
        }
    }
}
