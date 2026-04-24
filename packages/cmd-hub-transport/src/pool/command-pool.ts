export interface PoolCommand {
    name: string
    compatibilityId: string
    version: string
    description: string
    args: unknown[]
    aliases: string[]
}

export interface PoolMember {
    nodeId: string
    version: string
    command: PoolCommand
}

export type PoolJoinResult =
    | { ok: true }
    | { ok: false; reason: string }

interface PoolEntry {
    compatibilityId: string
    major: number
    members: PoolMember[]
    rrIndex: number
}

function majorOf(version: string): number | null {
    const m = version.match(/^(\d+)\./)
    return m ? Number(m[1]) : null
}

export class CommandPool {
    private readonly pools = new Map<string, PoolEntry>()

    join(nodeId: string, cmd: PoolCommand): PoolJoinResult {
        if (!cmd.name) return { ok: false, reason: 'missing command name' }
        if (!cmd.compatibilityId) return { ok: false, reason: 'missing compatibility_id' }
        if (!cmd.version) return { ok: false, reason: 'missing version' }
        const major = majorOf(cmd.version)
        if (major === null) return { ok: false, reason: `invalid semver version: ${cmd.version}` }

        const existing = this.pools.get(cmd.name)
        if (!existing) {
            this.pools.set(cmd.name, {
                compatibilityId: cmd.compatibilityId,
                major,
                members: [{ nodeId, version: cmd.version, command: cmd }],
                rrIndex: 0,
            })
            return { ok: true }
        }
        if (existing.compatibilityId !== cmd.compatibilityId) {
            return {
                ok: false,
                reason:
                    `compatibility_id mismatch: pool has "${existing.compatibilityId}", ` +
                    `this node declares "${cmd.compatibilityId}"`,
            }
        }
        if (existing.major !== major) {
            return {
                ok: false,
                reason: `incompatible major version: pool is ${existing.major}.x, this node is ${major}.x`,
            }
        }
        existing.members.push({ nodeId, version: cmd.version, command: cmd })
        return { ok: true }
    }

    removeNode(nodeId: string): void {
        for (const [name, entry] of this.pools) {
            entry.members = entry.members.filter((m) => m.nodeId !== nodeId)
            if (entry.members.length === 0) this.pools.delete(name)
        }
    }

    members(name: string): PoolMember[] {
        return this.pools.get(name)?.members ?? []
    }

    names(): string[] {
        return [...this.pools.keys()]
    }

    pick(name: string, opts?: { nodeId?: string }): PoolMember | null {
        const entry = this.pools.get(name)
        if (!entry || entry.members.length === 0) return null
        if (opts?.nodeId) {
            return entry.members.find((m) => m.nodeId === opts.nodeId) ?? null
        }
        const pick = entry.members[entry.rrIndex % entry.members.length]
        entry.rrIndex = (entry.rrIndex + 1) % entry.members.length
        return pick
    }
}
