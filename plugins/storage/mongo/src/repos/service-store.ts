import type {
    IServiceStore,
    IServiceStoreLoadResult,
    IServiceAccountLayer,
    IServiceSessionLayer,
    IAccountModuleHandle,
    IAccountSessionHandle,
} from '@cmd-hub/common'
import { ManagerModel } from '../models/manager.model'
import { AccountModel } from '../models/account/account.model'
import { MongoAccountHandle } from './account-handle'

/** Adapt the broad storage `IAccountModuleHandle` to the narrow service
 *  account-layer interface `BaseCommandService` expects. */
class ServiceAccountLayerAdapter implements IServiceAccountLayer {
    constructor(private readonly inner: IAccountModuleHandle) {}

    get data(): Record<string, unknown> {
        return this.inner.record.data
    }

    setField(path: string, value: unknown): Promise<void> {
        return this.inner.setDataPath(path, value)
    }

    replaceArgs(args: Record<string, unknown>): Promise<void> {
        return this.inner.replaceArgs(args)
    }
}

class ServiceSessionLayerAdapter implements IServiceSessionLayer {
    constructor(private readonly inner: IAccountSessionHandle) {}

    get name(): string { return this.inner.record.name }
    get data(): Record<string, unknown> { return this.inner.record.data }

    setField(path: string, value: unknown): Promise<void> {
        return this.inner.setDataPath(path, value)
    }

    setFields(updates: Record<string, unknown>): Promise<void> {
        return this.inner.setDataPaths(updates)
    }

    replaceData(data: Record<string, unknown>): Promise<void> {
        return this.inner.replaceData(data)
    }
}

/**
 * Mongo-backed `IServiceStore`. Looks up the Manager by `userId`, walks to
 * its Account, then either fetches or creates the requested module + session.
 */
export class MongoServiceStore implements IServiceStore {
    async load(input: {
        userId: string
        serviceName: string
        desiredSessionId: string
        defaultExpirityMs: number
        incrementalExpirity: boolean
    }): Promise<IServiceStoreLoadResult> {
        const manager = await ManagerModel.findOne({ userId: Number(input.userId) })
        if (!manager) {
            throw new Error(`MongoServiceStore.load: Manager not found for userId=${input.userId}`)
        }
        if (!manager.account) {
            throw new Error(`MongoServiceStore.load: Manager has no account (userId=${input.userId})`)
        }
        const account = await AccountModel.findById(manager.account)
        if (!account) {
            throw new Error(`MongoServiceStore.load: Account not found for ${manager.account.toHexString()}`)
        }
        const accountHandle = new MongoAccountHandle(account)
        const { isNew, module } = await accountHandle.getModuleByNameOrCreate(input.serviceName)

        let sessionHandle = await module.getSession(input.desiredSessionId)
        if (isNew || !sessionHandle) {
            sessionHandle = await module.createAndApplySession({
                name: input.desiredSessionId,
                expirity: input.defaultExpirityMs,
                incrementalExpirity: input.incrementalExpirity,
            })
        }
        if (!sessionHandle) {
            throw new Error(
                `MongoServiceStore.load: cannot resolve session "${input.desiredSessionId}" on module "${input.serviceName}" for userId=${input.userId}`,
            )
        }

        return {
            accountLayer: new ServiceAccountLayerAdapter(module),
            sessionLayer: new ServiceSessionLayerAdapter(sessionHandle),
        }
    }
}
