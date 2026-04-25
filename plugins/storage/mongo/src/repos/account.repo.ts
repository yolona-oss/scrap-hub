import type {
    IAccountRepo,
    IAccountHandle,
    AccountRecord,
} from '@cmd-hub/common'
import { AccountModel } from '../models/account/account.model'
import { MongoAccountHandle, accountDocToRecord } from './account-handle'

export class MongoAccountRepo implements IAccountRepo {
    async findById(id: string): Promise<AccountRecord | null> {
        const doc = await AccountModel.findById(id)
        return doc ? accountDocToRecord(doc) : null
    }

    async findByOwnerId(ownerId: string): Promise<AccountRecord | null> {
        const doc = await AccountModel.findOne({ owner_id: ownerId })
        return doc ? accountDocToRecord(doc) : null
    }

    async handleById(id: string): Promise<IAccountHandle | null> {
        const doc = await AccountModel.findById(id)
        return doc ? new MongoAccountHandle(doc) : null
    }

    async handleByOwnerId(ownerId: string): Promise<IAccountHandle | null> {
        const doc = await AccountModel.findOne({ owner_id: ownerId })
        return doc ? new MongoAccountHandle(doc) : null
    }
}
