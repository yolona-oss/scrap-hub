import { Account, Manager } from '../db'
import type {
    IServiceStore,
    IServiceStoreLoadResult,
    IServiceModuleHandle,
    IServiceSessionHandle,
} from '@cmd-hub/common'

class MongoModuleHandle implements IServiceModuleHandle {
    constructor(private readonly doc: any) {}
    get data(): Record<string, unknown> {
        return (this.doc.data ?? {}) as Record<string, unknown>
    }
    async setField(path: string, value: unknown): Promise<void> {
        this.doc.set(path.length > 0 ? `data.${path}` : 'data', value)
        await this.doc.save()
    }
    async replaceConfig(config: Record<string, unknown>): Promise<void> {
        this.doc.set('data.config', config)
        await this.doc.save()
    }
}

class MongoSessionHandle implements IServiceSessionHandle {
    constructor(private readonly doc: any) {}
    get name(): string { return this.doc.name }
    get data(): Record<string, unknown> {
        return (this.doc.data ?? {}) as Record<string, unknown>
    }
    async setField(path: string, value: unknown): Promise<void> {
        this.doc.set(path.length > 0 ? `data.${path}` : 'data', value)
        await this.doc.save()
    }
    async replaceData(data: Record<string, unknown>): Promise<void> {
        this.doc.set('data', data)
        await this.doc.save()
    }
}

export class MongoServiceStore implements IServiceStore {
    async load(input: {
        userId: string
        serviceName: string
        desiredSessionId: string
        defaultExpirityMs: number
        incrementalExpirity: boolean
    }): Promise<IServiceStoreLoadResult> {
        const owner = await Manager.findOne({ userId: input.userId })
        if (!owner) throw new Error(`MongoServiceStore.load: Manager not found for userId=${input.userId}`)
        const account = await Account.findById(owner.account)
        if (!account) throw new Error(`MongoServiceStore.load: Account not found for ${owner.account}`)
        const { isNew, account_module } = await account.getModuleByNameOrCreate(input.serviceName)
        const sessions = await account_module.getSessions()
        let session = sessions.find((s: any) => s.name === input.desiredSessionId)
        if (isNew || !session) {
            session = await account_module.createAndApplySession({
                name: input.desiredSessionId,
                expirity: input.defaultExpirityMs,
                incrementalExpirity: input.incrementalExpirity,
            })
        }
        if (!session) {
            throw new Error(
                `MongoServiceStore.load: cannot resolve session '${input.desiredSessionId}' on module '${input.serviceName}' for userId=${input.userId}`,
            )
        }
        return {
            module: new MongoModuleHandle(account_module),
            session: new MongoSessionHandle(session),
        }
    }
}
