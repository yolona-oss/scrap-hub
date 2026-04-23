import type { SessionContext } from '../types'
import type { InvocationHandle } from '../client/cmd-node-client'

export interface SessionEntry {
    readonly ctx: SessionContext
    readonly handle: InvocationHandle
}

/**
 * In-memory registry of live command invocations on the hub. Two-way indexing:
 * by sessionId for direct lookup, by userId for listing a user's running work.
 * The hub is a single process in v1, so this lives only in memory; audit-level
 * persistence of SessionContext is the dispatcher's concern, not this index.
 */
export class SessionIndex {
    private readonly bySession = new Map<string, SessionEntry>()
    private readonly byUser = new Map<string, Set<string>>()

    register(ctx: SessionContext, handle: InvocationHandle): void {
        if (this.bySession.has(ctx.sessionId)) {
            throw new Error(`sessionId already registered: ${ctx.sessionId}`)
        }
        this.bySession.set(ctx.sessionId, { ctx, handle })
        let set = this.byUser.get(ctx.userId)
        if (!set) {
            set = new Set()
            this.byUser.set(ctx.userId, set)
        }
        set.add(ctx.sessionId)
    }

    getBySession(sessionId: string): SessionEntry | null {
        return this.bySession.get(sessionId) ?? null
    }

    getByUser(userId: string): SessionEntry[] {
        const ids = this.byUser.get(userId)
        if (!ids) return []
        const out: SessionEntry[] = []
        for (const id of ids) {
            const e = this.bySession.get(id)
            if (e) out.push(e)
        }
        return out
    }

    remove(sessionId: string): void {
        const entry = this.bySession.get(sessionId)
        if (!entry) return
        this.bySession.delete(sessionId)
        const set = this.byUser.get(entry.ctx.userId)
        if (set) {
            set.delete(sessionId)
            if (set.size === 0) this.byUser.delete(entry.ctx.userId)
        }
    }

    list(): SessionEntry[] {
        return [...this.bySession.values()]
    }
}
