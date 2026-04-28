import type {
    ISessionLogRepo,
    SessionLogEntry,
    SessionLogReadOptions,
    SessionLogSummary,
} from '@cmd-hub/common'

/**
 * In-progress: the persistent session log model hasn't landed yet.
 * This stub satisfies the ISessionLogRepo contract with in-memory
 * storage so the rest of the system (writer, replay, dashboard
 * resume) compiles and runs end-to-end. Replace with a real Mongo
 * model once the schema is finalized.
 */
export class MongoSessionLogRepo implements ISessionLogRepo {
    private readonly bySession = new Map<string, SessionLogEntry[]>()

    async append(entries: SessionLogEntry[]): Promise<void> {
        for (const e of entries) {
            const list = this.bySession.get(e.sessionId) ?? []
            list.push(e)
            this.bySession.set(e.sessionId, list)
        }
    }

    async read(sessionId: string, opts: SessionLogReadOptions = {}): Promise<SessionLogEntry[]> {
        const list = this.bySession.get(sessionId) ?? []
        const fromSeq = opts.fromSeq ?? -Infinity
        const toSeq = opts.toSeq ?? Infinity
        const filtered = list.filter(e => e.seq >= fromSeq && e.seq <= toSeq)
        return opts.limit !== undefined ? filtered.slice(0, opts.limit) : filtered
    }

    async latestSeq(sessionId: string): Promise<number> {
        const list = this.bySession.get(sessionId)
        if (!list || list.length === 0) return -1
        let max = -1
        for (const e of list) if (e.seq > max) max = e.seq
        return max
    }

    async deleteBySession(sessionId: string): Promise<number> {
        const list = this.bySession.get(sessionId)
        if (!list) return 0
        this.bySession.delete(sessionId)
        return list.length
    }

    async listSessions(opts: { limit?: number; sinceMs?: number } = {}): Promise<SessionLogSummary[]> {
        const cutoff = opts.sinceMs ?? 0
        const out: SessionLogSummary[] = []
        for (const [sessionId, list] of this.bySession) {
            if (list.length === 0) continue
            let lastTs = 0
            for (const e of list) if (e.ts > lastTs) lastTs = e.ts
            if (lastTs < cutoff) continue
            out.push({ sessionId, lastTs, count: list.length })
        }
        out.sort((a, b) => b.lastTs - a.lastTs)
        return opts.limit !== undefined ? out.slice(0, opts.limit) : out
    }
}
