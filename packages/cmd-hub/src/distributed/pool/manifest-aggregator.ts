import { CommandPool } from './command-pool'

export interface AggregatedManifest {
    nodeId: string
    nodeName: string
    version: string
    commands: Array<{
        name: string
        compatibilityId: string
        version: string
        description: string
        args: unknown[]
        aliases: string[]
    }>
    services: unknown[]
    configs: Array<{ name: string; scope: string; fields: unknown[] }>
    hardware: unknown
    metrics: unknown
}

export type AttachResult =
    | { ok: true }
    | { ok: false; rejected: Array<{ command: string; reason: string }> }

/**
 * Aggregates manifests from connected nodes into a unified view of the
 * federation. Attachment is atomic: a manifest that cannot place all its
 * commands into the CommandPool is rejected wholesale — no partial state.
 */
export class ManifestAggregator {
    private readonly pool = new CommandPool()
    private readonly byNode = new Map<string, AggregatedManifest>()
    private readonly configSchemaIndex = new Map<string, Set<string>>()

    getPool(): CommandPool {
        return this.pool
    }

    listCommandNames(): string[] {
        return this.pool.names().sort()
    }

    getManifest(nodeId: string): AggregatedManifest | undefined {
        return this.byNode.get(nodeId)
    }

    listManifests(): AggregatedManifest[] {
        return [...this.byNode.values()]
    }

    attach(m: AggregatedManifest): AttachResult {
        // Reject double-attach for the same node id.
        if (this.byNode.has(m.nodeId)) {
            return {
                ok: false,
                rejected: [{ command: '*', reason: `node ${m.nodeId} already attached` }],
            }
        }

        for (const c of m.commands) {
            const r = this.pool.join(m.nodeId, c)
            if (!r.ok) {
                // Roll back any partial joins this node made before failing.
                this.pool.removeNode(m.nodeId)
                return {
                    ok: false,
                    rejected: [{ command: c.name, reason: r.reason }],
                }
            }
        }

        this.byNode.set(m.nodeId, m)
        for (const mod of m.configs) {
            if (!this.configSchemaIndex.has(mod.name)) {
                this.configSchemaIndex.set(mod.name, new Set())
            }
            this.configSchemaIndex.get(mod.name)!.add(m.nodeId)
        }
        return { ok: true }
    }

    detach(nodeId: string): void {
        this.pool.removeNode(nodeId)
        this.byNode.delete(nodeId)
        for (const [mod, nodes] of this.configSchemaIndex) {
            nodes.delete(nodeId)
            if (nodes.size === 0) this.configSchemaIndex.delete(mod)
        }
    }

    configModuleOwners(module: string): string[] {
        return [...(this.configSchemaIndex.get(module) ?? [])]
    }

    configModuleNames(): string[] {
        return [...this.configSchemaIndex.keys()].sort()
    }
}
