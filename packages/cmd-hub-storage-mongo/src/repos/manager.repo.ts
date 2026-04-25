import type {
    IManagerRepo,
    IManagerHandle,
    ManagerRecord,
    ManagerUpdate,
    CreateManagerInput,
} from '@cmd-hub/common'
import { ManagerModel, type ManagerHydrated } from '../models/manager.model'
import { AccountModel } from '../models/account/account.model'
import { MongoManagerHandle, managerDocToRecord } from './manager-handle'

export class MongoManagerRepo implements IManagerRepo {
    async findById(id: string): Promise<ManagerRecord | null> {
        const doc = await ManagerModel.findById(id)
        return doc ? managerDocToRecord(doc) : null
    }

    async findByUserId(userId: number | string): Promise<ManagerRecord | null> {
        const doc = await ManagerModel.findOne({ userId: typeof userId === 'string' ? Number(userId) : userId })
        return doc ? managerDocToRecord(doc) : null
    }

    async findByName(name: string): Promise<ManagerRecord | null> {
        const doc = await ManagerModel.findOne({ name })
        return doc ? managerDocToRecord(doc) : null
    }

    async list(): Promise<ManagerRecord[]> {
        const docs = await ManagerModel.find()
        return docs.map(managerDocToRecord)
    }

    /** Two-phase create: Manager.account is null at first because Account.owner_id
     *  must reference a Manager. We create the Manager first, then the Account
     *  pointing back at it, then patch Manager.account. Idempotent on `userId`. */
    async createWithAccount(input: CreateManagerInput): Promise<ManagerRecord> {
        const existing = await ManagerModel.findOne({ userId: input.userId })
        if (existing) return managerDocToRecord(existing)

        const manager = await ManagerModel.create({
            userId:        input.userId,
            name:          input.name,
            isAdmin:       input.isAdmin ?? false,
            useGreeting:   input.useGreeting,
            messageWidth:  input.messageWidth,
            passwordHash:  input.passwordHash,
            account:       null,
        })
        const account = await AccountModel.create({ owner_id: manager._id, module_ids: [] })
        manager.account = account._id
        await manager.save()
        return managerDocToRecord(manager)
    }

    async updateById(id: string, patch: ManagerUpdate): Promise<void> {
        const $set: Record<string, unknown> = {}
        if (patch.name !== undefined)         $set.name = patch.name
        if (patch.isAdmin !== undefined)      $set.isAdmin = patch.isAdmin
        if (patch.online !== undefined)       $set.online = patch.online
        if (patch.useGreeting !== undefined)  $set.useGreeting = patch.useGreeting
        if (patch.messageWidth !== undefined) $set.messageWidth = patch.messageWidth
        if (patch.passwordHash !== undefined) $set.passwordHash = patch.passwordHash
        if (Object.keys($set).length === 0) return
        await ManagerModel.updateOne({ _id: id }, { $set })
    }

    async setAllOffline(): Promise<void> {
        await ManagerModel.updateMany({ online: true }, { online: false })
    }

    async handleById(id: string): Promise<IManagerHandle | null> {
        const doc = await ManagerModel.findById(id)
        return doc ? new MongoManagerHandle(doc) : null
    }

    async handleByUserId(userId: number | string): Promise<IManagerHandle | null> {
        const numericId = typeof userId === 'string' ? Number(userId) : userId
        const doc = await ManagerModel.findOne({ userId: numericId })
        return doc ? new MongoManagerHandle(doc) : null
    }

    /** Internal helper used by `MongoServiceStore` — saves a redundant lookup
     *  when the caller already has the hydrated doc. */
    static toHandle(doc: ManagerHydrated): IManagerHandle {
        return new MongoManagerHandle(doc)
    }
}
