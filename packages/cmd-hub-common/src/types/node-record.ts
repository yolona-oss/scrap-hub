/**
 * Persistent registration record for a cmd-node.
 *
 * Owned by the hub-side `CmdNodeRegistry` and persisted via `INodeRecordRepo`.
 * Lives in `@cmd-hub/common` (rather than `@cmd-hub/transport`) so storage
 * drivers can implement the repo without a transport dep, and so the type
 * is reusable by tooling/CLI.
 */

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
