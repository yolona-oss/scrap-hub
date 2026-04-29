import type { NodeRecord, NodeState } from '../types/node-record'
import type {
    ManagerRecord, ManagerUpdate,
    AccountRecord, AccountModuleRecord, AccountSessionRecord,
    InvitationLinkRecord, CmdAliasRecord, PendingDeleteRecord,
    MessageHistoryEntry, MessageHistoryInput,
} from './records'

export interface ISystemConfigRepo {
    findByModule(name: string): Promise<{ data: Record<string, unknown> } | null>
    insertIfAbsent(name: string, data: Record<string, unknown>): Promise<void>
    setPath(name: string, path: string, value: unknown): Promise<void>
    clear(name: string): Promise<void>
}

export interface IUserConfigRepo {
    findByUserAndModule(userId: string, module: string): Promise<{ data: Record<string, unknown> } | null>
    setPath(userId: string, module: string, path: string, value: unknown): Promise<void>
    clear(userId: string, module: string): Promise<void>
}

export interface INodeRecordRepo {
    create(record: NodeRecord): Promise<void>
    findById(nodeId: string): Promise<NodeRecord | null>
    list(): Promise<NodeRecord[]>
    setState(nodeId: string, state: NodeState, options?: { onlyIfState?: NodeState }): Promise<number>
    markRegistered(
        nodeId: string,
        patch: { registeredAt: number; lastSeen: number; manifestSnapshotId: string },
    ): Promise<NodeRecord | null>
    touchLastSeen(nodeId: string, ts: number): Promise<void>
    deleteById(nodeId: string): Promise<void>
}

export interface IManagerHandle {
    readonly record: ManagerRecord
    getMessagesHistory(): Promise<MessageHistoryEntry[]>
    appendMessage(input: MessageHistoryInput): Promise<void>
    editMessage(input: MessageHistoryInput): Promise<void>
    deleteMessage(messageId: number): Promise<void>
}

export interface CreateManagerInput {
    userId: number
    name: string
    isAdmin?: boolean
    useGreeting?: boolean
    messageWidth?: number
    passwordHash?: string
}

export interface IManagerRepo {
    findById(id: string): Promise<ManagerRecord | null>
    findByUserId(userId: number | string): Promise<ManagerRecord | null>
    findByName(name: string): Promise<ManagerRecord | null>
    list(): Promise<ManagerRecord[]>
    createWithAccount(input: CreateManagerInput): Promise<ManagerRecord>
    updateById(id: string, patch: ManagerUpdate): Promise<void>
    setAllOffline(): Promise<void>
    handleById(id: string): Promise<IManagerHandle | null>
    handleByUserId(userId: number | string): Promise<IManagerHandle | null>
}

export interface IAccountSessionHandle {
    readonly record: AccountSessionRecord
    isDefault(): boolean
    isExpired(): boolean
    extendExpirity(addTime: number): Promise<void>
    incrementExpirity(): Promise<void>
    setDataPath(path: string, value: unknown): Promise<void>
    setDataPaths(updates: Record<string, unknown>): Promise<void>
    replaceData(data: Record<string, unknown>): Promise<void>
}

export interface CreateAccountSessionInput {
    name?: string
    expirity: number
    incrementalExpirity: boolean
    data?: Record<string, unknown>
}

export interface IAccountModuleHandle {
    readonly record: AccountModuleRecord
    getSessions(): Promise<IAccountSessionHandle[]>
    getSession(name: string): Promise<IAccountSessionHandle | null>
    createAndApplySession(input: CreateAccountSessionInput): Promise<IAccountSessionHandle>
    setDataPath(path: string, value: unknown): Promise<void>
    replaceArgs(args: Record<string, unknown>): Promise<void>
    clearData(): Promise<void>
}

export interface IAccountHandle {
    readonly record: AccountRecord
    getModules(): Promise<IAccountModuleHandle[]>
    getModuleByName(name: string): Promise<IAccountModuleHandle | null>
    getModuleByNameOrCreate(name: string): Promise<{ isNew: boolean; module: IAccountModuleHandle }>
    deleteModule(name: string): Promise<void>
}

export interface IAccountRepo {
    findById(id: string): Promise<AccountRecord | null>
    findByOwnerId(ownerId: string): Promise<AccountRecord | null>
    handleById(id: string): Promise<IAccountHandle | null>
    handleByOwnerId(ownerId: string): Promise<IAccountHandle | null>
}

export interface CreateInvitationLinkInput {
    token: string
    createdBy: number | string
    expiresAt?: Date
}

export interface IInvitationLinkRepo {
    create(input: CreateInvitationLinkInput): Promise<InvitationLinkRecord>
    findByToken(token: string, options?: { onlyUnused?: boolean }): Promise<InvitationLinkRecord | null>
    listRecent(limit: number): Promise<InvitationLinkRecord[]>
    markUsed(token: string, usedBy: number | string): Promise<void>
}

export interface CreateCmdAliasInput {
    alias: string
    command: string
    ownerId: string
}

export interface ICmdAliasRepo {
    listByOwner(ownerId: string): Promise<CmdAliasRecord[]>
    findByOwnerAndAlias(ownerId: string, alias: string): Promise<CmdAliasRecord | null>
    create(input: CreateCmdAliasInput): Promise<void>
    deleteByOwnerAndAlias(ownerId: string, alias: string): Promise<number>
}

export interface PendingDeleteUpsertInput {
    userId: string
    messageId: string
    type: string
    createdAt: number
    deleteAfter: number
}

export interface IPendingDeleteRepo {
    list(): Promise<PendingDeleteRecord[]>
    upsert(input: PendingDeleteUpsertInput): Promise<void>
    deleteOne(userId: string, messageId: string): Promise<void>
    deleteAll(): Promise<void>
}
