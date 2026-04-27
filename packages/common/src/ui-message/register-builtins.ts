import type { IUiMessageRendererRegistry } from './registry'
import type { INodeUiMessageRegistry } from './node-registry'
import {
    ALL_BUILTIN_PLUGINS,
    ESSENTIAL_BUILTIN_PLUGINS,
    OPTIONAL_BUILTIN_PLUGINS,
} from './builtin-plugins'

/** Names of optional builtins UIs may opt into. */
export type OptionalBuiltinKind = 'markdown' | 'list' | 'kv' | 'link'

/** Register the framework's essential builtins (`text` + `code`) plus a
 *  caller-chosen subset of optional ones onto a UI's renderer registry.
 *  UIs that want every builtin pass `'all'`. */
export function registerBuiltinRenderers(
    registry: IUiMessageRendererRegistry,
    optional: ReadonlyArray<OptionalBuiltinKind> | 'all' = 'all',
): void {
    for (const plugin of ESSENTIAL_BUILTIN_PLUGINS) {
        registry.register(plugin)
    }
    const wanted: ReadonlySet<string> = optional === 'all'
        ? new Set(OPTIONAL_BUILTIN_PLUGINS.map(p => p.kind))
        : new Set(optional)
    for (const plugin of OPTIONAL_BUILTIN_PLUGINS) {
        if (wanted.has(plugin.kind)) {
            registry.register(plugin)
        }
    }
}

/** Register every builtin's node-side build half on a node's registry.
 *  Node-side has no opt-in concept — the build helpers are tiny and
 *  always present so `BaseCommandService.send({kind:'list', ...})`
 *  doesn't crash on a kind the node "didn't opt into". UIs decide
 *  what they actually render. */
export function registerBuiltinBuilders(registry: INodeUiMessageRegistry): void {
    for (const plugin of ALL_BUILTIN_PLUGINS) {
        registry.register(plugin)
    }
}
