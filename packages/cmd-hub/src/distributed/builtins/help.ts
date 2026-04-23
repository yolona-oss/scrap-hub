import type { BuiltInHandler } from '../dispatcher/hub-dispatcher'
import type { ManifestAggregator } from '../pool/manifest-aggregator'

export interface HelpBuiltInDeps {
    aggregator: ManifestAggregator
    builtInNames: () => string[]
}

/**
 * /help renders the union of built-in commands and all pool commands from
 * currently-connected nodes. Each entry is annotated with the source so the
 * operator can see which nodes serve each command.
 */
export function makeHelpBuiltIn(deps: HelpBuiltInDeps): BuiltInHandler {
    return async () => {
        const pool = deps.aggregator.getPool()
        const lines: string[] = []

        for (const name of deps.builtInNames().sort()) {
            lines.push(`/${name}\tbuilt-in`)
        }

        for (const name of deps.aggregator.listCommandNames()) {
            const members = pool.members(name)
            const nodes = members.map((m) => `${m.nodeId}@${m.version}`).join(', ')
            lines.push(`/${name}\tnodes: ${nodes}`)
        }

        const text = lines.length === 0 ? 'no commands registered' : lines.join('\n')
        return { success: true, markup: { text }, messageType: 'system' }
    }
}
