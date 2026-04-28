/** Plain-data record shapes returned by storage repos. These are wire
 *  contracts: drivers project their internal documents into these
 *  shapes; consumers (hub, node, plugins) read them without touching
 *  the driver-specific document types. */

export interface ManagerRecord {
    readonly id: string
    readonly userId: number
    name: string
    isAdmin: boolean
    online: boolean
    accountId: string | null
    useGreeting: boolean
    messageWidth: number | null
    passwordHash: string | null
}

export interface ManagerUpdate {
    name?: string
    isAdmin?: boolean
    online?: boolean
    useGreeting?: boolean
    messageWidth?: number | null
    passwordHash?: string | null
}

export interface AccountRecord {
    readonly id: string
    readonly ownerId: string
}

export interface AccountModuleRecord {
    readonly id: string
    readonly accountId: string
    readonly name: string
    readonly data: Record<string, unknown>
}

export interface AccountSessionRecord {
    readonly id: string
    readonly name: string
    readonly createTime: number
    readonly expirity: number
    readonly initialExpirity: number
    readonly incrementalExpirity: boolean
    readonly data: Record<string, unknown>
}

export interface InvitationLinkRecord {
    readonly id: string
    readonly token: string
    readonly createdBy: number | string
    readonly usedBy: number | string | null
    readonly used: boolean
    readonly expiresAt: Date | null
}

export interface CmdAliasRecord {
    readonly id: string
    readonly alias: string
    readonly command: string
    readonly ownerId: string
}

export interface PendingDeleteRecord {
    readonly userId: string
    readonly messageId: string
    readonly type: string
    readonly createdAt: number
    readonly deleteAfter: number
}

export interface MessageHistoryEntry {
    readonly chatId: number
    readonly userId: number
    readonly messageId: number
    readonly text: string
    readonly isEdited: boolean
    readonly timestamp: Date | null
}

export interface MessageHistoryInput {
    readonly chatId: number
    readonly userId: number
    readonly messageId?: number
    readonly text: string
    readonly isEdited?: boolean
    readonly timestamp?: number
}
