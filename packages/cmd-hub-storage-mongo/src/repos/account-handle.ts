import type {
    IAccountHandle,
    IAccountModuleHandle,
    IAccountSessionHandle,
    AccountRecord,
    AccountModuleRecord,
    AccountSessionRecord,
    CreateAccountSessionInput,
} from '@cmd-hub/common'
import { AccountModel, type AccountHydrated } from '../models/account/account.model'
import {
    AccountModuleModel,
    type AccountModuleHydrated,
    isValidModuleName,
} from '../models/account/account-module.model'
import {
    AccountSessionModel,
    type AccountSessionHydrated,
    DEFAULT_ACCOUNT_SESSION_NAME,
} from '../models/account/account-session.model'

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export function accountDocToRecord(doc: AccountHydrated): AccountRecord {
    return {
        id: doc._id.toHexString(),
        ownerId: doc.owner_id.toHexString(),
    }
}

export function accountModuleDocToRecord(doc: AccountModuleHydrated): AccountModuleRecord {
    return {
        id: doc._id.toHexString(),
        accountId: doc.account_id.toHexString(),
        name: doc.name,
        data: doc.data ?? {},
    }
}

export function accountSessionDocToRecord(doc: AccountSessionHydrated): AccountSessionRecord {
    return {
        id: doc._id.toHexString(),
        name: doc.name,
        createTime: doc.createTime,
        expirity: doc.expirity,
        initialExpirity: doc.initialExpirity,
        incrementalExpirity: doc.incrementalExpirity,
        data: doc.data ?? {},
    }
}

// ---------------------------------------------------------------------------
// Session handle
// ---------------------------------------------------------------------------

export class MongoAccountSessionHandle implements IAccountSessionHandle {
    constructor(private readonly doc: AccountSessionHydrated) {}

    get record(): AccountSessionRecord {
        return accountSessionDocToRecord(this.doc)
    }

    isDefault(): boolean {
        return this.doc.name === DEFAULT_ACCOUNT_SESSION_NAME
    }

    isExpired(): boolean {
        return this.doc.createTime + this.doc.expirity < Date.now()
    }

    async extendExpirity(addTime: number): Promise<void> {
        if (addTime <= 0) {
            throw new Error('extendExpirity: addTime must be greater than 0')
        }
        this.doc.expirity += addTime
        await this.doc.save()
    }

    async incrementExpirity(): Promise<void> {
        this.doc.expirity += this.doc.initialExpirity
        await this.doc.save()
    }

    async setDataPath(path: string, value: unknown): Promise<void> {
        if (path.length === 0) return
        this.doc.set(`data.${path}`, value)
        await this.doc.save()
    }

    async replaceData(data: Record<string, unknown>): Promise<void> {
        this.doc.set('data', data)
        await this.doc.save()
    }
}

// ---------------------------------------------------------------------------
// Module handle
// ---------------------------------------------------------------------------

export class MongoAccountModuleHandle implements IAccountModuleHandle {
    constructor(private readonly doc: AccountModuleHydrated) {}

    get record(): AccountModuleRecord {
        return accountModuleDocToRecord(this.doc)
    }

    async getSessions(): Promise<IAccountSessionHandle[]> {
        const populated = await this.doc.populate<{ session_ids: AccountSessionHydrated[] }>('session_ids')
        return (populated.session_ids ?? []).map((s) => new MongoAccountSessionHandle(s))
    }

    async getSession(name: string): Promise<IAccountSessionHandle | null> {
        const sessions = await this.getSessions()
        return sessions.find((s) => s.record.name === name) ?? null
    }

    async createAndApplySession(input: CreateAccountSessionInput): Promise<IAccountSessionHandle> {
        const realname = input.name ?? DEFAULT_ACCOUNT_SESSION_NAME
        if (!isValidModuleName(realname)) {
            throw new Error(`Invalid session name: "${realname}"`)
        }
        if (realname !== DEFAULT_ACCOUNT_SESSION_NAME) {
            const existing = await this.getSession(realname)
            if (existing) {
                throw new Error(`Session name "${realname}" already exists`)
            }
        }
        const session = await AccountSessionModel.create({
            name: realname,
            expirity: input.expirity,
            incrementalExpirity: input.incrementalExpirity,
            data: input.data ?? {},
        })
        this.doc.session_ids.push(session._id)
        await this.doc.save()
        return new MongoAccountSessionHandle(session)
    }

    async setDataPath(path: string, value: unknown): Promise<void> {
        this.doc.set(path.length > 0 ? `data.${path}` : 'data', value)
        await this.doc.save()
    }

    async replaceConfig(config: Record<string, unknown>): Promise<void> {
        this.doc.set('data.config', config)
        await this.doc.save()
    }

    async clearData(): Promise<void> {
        this.doc.set('data', {})
        await this.doc.save()
    }
}

// ---------------------------------------------------------------------------
// Account handle
// ---------------------------------------------------------------------------

export class MongoAccountHandle implements IAccountHandle {
    constructor(private readonly doc: AccountHydrated) {}

    get record(): AccountRecord {
        return accountDocToRecord(this.doc)
    }

    async getModules(): Promise<IAccountModuleHandle[]> {
        const populated = await this.doc.populate<{ module_ids: AccountModuleHydrated[] }>('module_ids')
        return (populated.module_ids ?? []).map((m) => new MongoAccountModuleHandle(m))
    }

    async getModuleByName(name: string): Promise<IAccountModuleHandle | null> {
        const modules = await this.getModules()
        return modules.find((m) => m.record.name === name) ?? null
    }

    async getModuleByNameOrCreate(name: string): Promise<{ isNew: boolean; module: IAccountModuleHandle }> {
        const existing = await this.getModuleByName(name)
        if (existing) return { isNew: false, module: existing }

        const newDoc = await AccountModuleModel.create({ name, account_id: this.doc._id })
        this.doc.module_ids.push(newDoc._id)
        await this.doc.save()
        return { isNew: true, module: new MongoAccountModuleHandle(newDoc) }
    }

    async deleteModule(name: string): Promise<void> {
        const populated = await this.doc.populate<{ module_ids: AccountModuleHydrated[] }>('module_ids')
        const target = (populated.module_ids ?? []).find((m) => m.name === name)
        if (!target) return

        this.doc.module_ids = this.doc.module_ids.filter(
            (id) => id.toHexString() !== target._id.toHexString(),
        )
        await this.doc.save()
        await AccountModuleModel.findByIdAndDelete(target._id)
    }
}

export { AccountModel }
