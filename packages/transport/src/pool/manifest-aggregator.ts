import { log, BaseCommandIdentity, type OptionsTree } from '@cmd-hub/common'
import { CommandPool } from './command-pool'

export interface AggregatedCommand extends BaseCommandIdentity {
    /** Single root tree describing the command's options. May be a leaf
     *  (single-arg command) or a branch (multiple options). */
    options: OptionsTree
    aliases: string[]
    requires?: readonly string[]
}

export interface AggregatedManifest {
    nodeId: string
    nodeName: string
    version: string
    commands: AggregatedCommand[]
    services: unknown[]
    configs: Array<{ name: string; scope: string; fields: unknown[] }>
    hardware: unknown
    metrics: unknown
    /** Optional in the type to keep test fixtures terse; production
     *  nodes always set this (CmdNodeApp.buildManifest emits it). */
    publishedCapabilities?: readonly string[]
}

/** Mirror of `UIFederationRequires` in `@cmd-hub/core`, with cap keys resolved
 *  to plain strings. */
export interface UIRequirementsForFiltering {
    readonly uiName: string
    readonly essential: readonly string[]
    readonly supported: readonly string[]
}

export interface AttachWarning {
    readonly uiName: string
    readonly nodeId: string
    readonly commandName: string
    readonly compatibilityId: string
    readonly commandVersion: string
    readonly missingCaps: readonly string[]
    readonly severity: 'rejected' | 'warned'
}

export type AttachResult =
    | { ok: true; warnings: AttachWarning[] }
    | { ok: false; rejected: Array<{ command: string; reason: string }>; warnings: AttachWarning[] }

/**
 * Aggregates manifests from connected nodes. Per-UI eligibility: when
 * `setUIRequirements()` was called, commands missing essential caps for a
 * given UI are dropped from THAT UI's routing pool but kept for others;
 * supported gaps are warnings only. Manifest-level rejections
 * (compatibility_id mismatch, major-version skew) apply across all UIs.
 */
export class ManifestAggregator {
    private readonly pool = new CommandPool()
    private readonly byNode = new Map<string, AggregatedManifest>()
    private readonly configSchemaIndex = new Map<string, Set<string>>()
    private _uiRequirements: ReadonlyArray<UIRequirementsForFiltering> = []
    private readonly _warnings: AttachWarning[] = []
    private readonly _changeListeners = new Set<() => void>()

    /** Subscribe to attach/detach events. Returns an unsubscribe function.
     *  Listener errors are swallowed so one bad subscriber can't stall routing. */
    onChange(listener: () => void): () => void {
        this._changeListeners.add(listener)
        return () => this._changeListeners.delete(listener)
    }

    private _emitChange(): void {
        for (const listener of this._changeListeners) {
            try { listener() } catch { /* one listener mustn't break others */ }
        }
    }

    setUIRequirements(reqs: ReadonlyArray<UIRequirementsForFiltering>): void {
        this._uiRequirements = reqs
    }

    listWarnings(): ReadonlyArray<AttachWarning> {
        return this._warnings
    }

    getPool(): CommandPool {
        return this.pool
    }

    listCommandNames(): string[] {
        return this.pool.names().sort()
    }

    /** O(1) lookup via the pool's name index. */
    findCommand(name: string): AggregatedCommand | undefined {
        const members = this.pool.members(name)
        return members.length > 0 ? (members[0].command as AggregatedCommand) : undefined
    }

    getManifest(nodeId: string): AggregatedManifest | undefined {
        return this.byNode.get(nodeId)
    }

    listManifests(): AggregatedManifest[] {
        return [...this.byNode.values()]
    }

    /** Pass `replace: true` to atomically swap a stale prior attachment
     *  (same `nodeId`); this emits `onChange` once instead of the two
     *  emits manual detach+attach would produce. */
    attach(
        m: AggregatedManifest,
        uiRequirements?: ReadonlyArray<UIRequirementsForFiltering>,
        opts?: { replace?: boolean },
    ): AttachResult {
        const reqs = uiRequirements ?? this._uiRequirements

        if (this.byNode.has(m.nodeId)) {
            if (!opts?.replace) {
                return {
                    ok: false,
                    rejected: [{ command: '*', reason: `node ${m.nodeId} already attached` }],
                    warnings: [],
                }
            }
            // Drop prior session entries silently; one emit at end covers the whole transition.
            this.pool.removeNode(m.nodeId)
            this.byNode.delete(m.nodeId)
            for (const [mod, nodes] of this.configSchemaIndex) {
                nodes.delete(m.nodeId)
                if (nodes.size === 0) this.configSchemaIndex.delete(mod)
            }
        }

        const published = new Set(m.publishedCapabilities ?? [])
        const warnings: AttachWarning[] = []

        for (const c of m.commands) {
            const eligibleUIs = reqs.length > 0 ? new Set<string>() : undefined
            for (const ui of reqs) {
                const missingEssential = ui.essential.filter(k => !published.has(k))
                const missingSupported = ui.supported.filter(k => !published.has(k))
                if (missingEssential.length > 0) {
                    warnings.push({
                        uiName: ui.uiName,
                        nodeId: m.nodeId,
                        commandName: c.name,
                        compatibilityId: c.compatibilityId,
                        commandVersion: c.version,
                        missingCaps: missingEssential,
                        severity: 'rejected',
                    })
                    continue
                }
                if (missingSupported.length > 0) {
                    warnings.push({
                        uiName: ui.uiName,
                        nodeId: m.nodeId,
                        commandName: c.name,
                        compatibilityId: c.compatibilityId,
                        commandVersion: c.version,
                        missingCaps: missingSupported,
                        severity: 'warned',
                    })
                }
                eligibleUIs!.add(ui.uiName)
            }

            const r = this.pool.join(m.nodeId, c, eligibleUIs)
            if (!r.ok) {
                this.pool.removeNode(m.nodeId)
                this._warnings.push(...warnings)
                return {
                    ok: false,
                    rejected: [{ command: c.name, reason: r.reason }],
                    warnings,
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
        this._warnings.push(...warnings)
        log.info(`ManifestAggregator: attached node "${m.nodeId}" (${m.commands.length} commands, ${warnings.length} warning(s))`)
        this._emitChange()
        return { ok: true, warnings }
    }

    detach(nodeId: string): void {
        const had = this.byNode.has(nodeId)
        this.pool.removeNode(nodeId)
        this.byNode.delete(nodeId)
        for (const [mod, nodes] of this.configSchemaIndex) {
            nodes.delete(nodeId)
            if (nodes.size === 0) this.configSchemaIndex.delete(mod)
        }
        if (had) {
            log.info(`ManifestAggregator: detached node "${nodeId}"`)
            this._emitChange()
        }
    }

    configModuleOwners(module: string): string[] {
        return [...(this.configSchemaIndex.get(module) ?? [])]
    }

    configModuleNames(): string[] {
        return [...this.configSchemaIndex.keys()].sort()
    }
}
