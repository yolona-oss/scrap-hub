import { defineCapability } from '../application/capability'

export interface SessionLogEntry {
    sessionId: string
    seq: number
    ts: number
    kind: string
    severity?: string
    payload: Record<string, unknown>
    compatibilityId: string
    version: string
}

export interface SessionLogReadOptions {
    fromSeq?: number
    toSeq?: number
    limit?: number
}

export interface SessionLogSummary {
    sessionId: string
    lastTs: number
    count: number
}

export interface ISessionLogRepo {
    append(entries: SessionLogEntry[]): Promise<void>
    read(sessionId: string, opts?: SessionLogReadOptions): Promise<SessionLogEntry[]>
    latestSeq(sessionId: string): Promise<number>
    deleteBySession(sessionId: string): Promise<number>
    listSessions(opts?: { limit?: number; sinceMs?: number }): Promise<SessionLogSummary[]>
}

export const CAP_SessionLogRepo = defineCapability<ISessionLogRepo>('common.sessionLogRepo')
