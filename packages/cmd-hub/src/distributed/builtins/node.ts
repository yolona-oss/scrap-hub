import type { BuiltInHandler } from '../dispatcher/hub-dispatcher'
import type { CmdNodeRegistry } from '../registry/cmd-node-registry'
import type { ManifestAggregator } from '../pool/manifest-aggregator'

export interface NodeBuiltInDeps {
    registry: CmdNodeRegistry
    aggregator: ManifestAggregator
}

export function makeNodeBuiltIn(deps: NodeBuiltInDeps): BuiltInHandler {
    return async (input) => {
        const sub = (input.args.sub ?? 'list').toLowerCase()
        switch (sub) {
            case 'list': {
                const rows = await deps.registry.list()
                const text = rows.length === 0
                    ? 'no nodes registered'
                    : rows
                        .map((r) => `${r.nodeId}\t${r.state}\t${r.nodeName}\tlast-seen=${r.lastSeen ?? 'never'}`)
                        .join('\n')
                return { success: true, markup: { text }, messageType: 'system' }
            }
            case 'show': {
                const id = input.args.id
                if (!id) return { success: false, markup: { text: 'usage: /node show <id>' } }
                const r = await deps.registry.get(id)
                if (!r) return { success: false, markup: { text: `no such node: ${id}` } }
                const man = deps.aggregator.getManifest(id)
                const cmds = man?.commands.map((c) => `${c.name}@${c.version}`).join(', ')
                    ?? '(no active manifest)'
                return {
                    success: true,
                    markup: { text: `${r.nodeId} ${r.state}\nname=${r.nodeName}\ncommands=${cmds}` },
                }
            }
            case 'approve': {
                const id = input.args.id
                if (!id) return { success: false, markup: { text: 'usage: /node approve <id>' } }
                try {
                    await deps.registry.approve(id)
                } catch (e) {
                    return { success: false, markup: { text: String((e as Error).message) } }
                }
                return { success: true, markup: { text: `approved ${id}` } }
            }
            case 'deregister': {
                const id = input.args.id
                if (!id) return { success: false, markup: { text: 'usage: /node deregister <id>' } }
                await deps.registry.deregister(id)
                deps.aggregator.detach(id)
                return { success: true, markup: { text: `deregistered ${id}` } }
            }
            case 'forget': {
                const id = input.args.id
                if (!id) return { success: false, markup: { text: 'usage: /node forget <id>' } }
                await deps.registry.forget(id)
                deps.aggregator.detach(id)
                return { success: true, markup: { text: `forgot ${id}` } }
            }
            default:
                return { success: false, markup: { text: `unknown subcommand: ${sub}` } }
        }
    }
}
