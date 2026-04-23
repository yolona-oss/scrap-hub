export interface FileHandle {
    readonly fileId: string
    readonly backend: string
    readonly size: number
    readonly name: string
    readonly mime: string
    readonly permanent: boolean
}

export function isFileHandle(x: unknown): x is FileHandle {
    if (!x || typeof x !== 'object') return false
    const o = x as Record<string, unknown>
    return (
        typeof o.fileId === 'string' &&
        typeof o.backend === 'string' &&
        typeof o.size === 'number' &&
        typeof o.name === 'string' &&
        typeof o.mime === 'string' &&
        typeof o.permanent === 'boolean'
    )
}

export interface WriteGrant {
    readonly grantId: string
    readonly uploadUrl: string
    readonly token: string
    readonly expiresAt: number
    readonly prospective: FileHandle
}

export type NodeState = 'PENDING' | 'ACTIVE' | 'DISABLED'

export interface NodeRecord {
    readonly nodeId: string
    readonly nodeName: string
    state: NodeState
    readonly certFingerprint: string
    readonly tokenHash: string
    readonly createdVia: 'cli' | 'manual'
    registeredAt: number | null
    lastSeen: number | null
    manifestSnapshotId: string | null
}

export interface SessionContext {
    readonly sessionId: string
    readonly userId: string
    readonly command: string
    readonly nodeId: string
    readonly startedAt: number
    readonly uiHandle: unknown
}
