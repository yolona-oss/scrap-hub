import mongoose, { Schema, Document, Model, QueryWithHelpers, HydratedDocumentFromSchema } from 'mongoose';
import { DbModelsEnum } from '../../../db/models-enum';

import { AccountModuleHydratedDocument, AccountModule, AccountModuleModelType, AccountModuleSchema, IAccountModule } from './module';

import "reflect-metadata";
import { HydratedDocument } from 'mongoose';

export interface IAccount extends Document {
    owner_id: Schema.Types.ObjectId
    module_ids: Schema.Types.ObjectId[]
}

interface IAccountMethods {
    getModules(): Promise<AccountModuleHydratedDocument[]>,
    getModuleByName(name: string): Promise<AccountModuleHydratedDocument|undefined>
    getModuleByNameOrCreate(name: string): Promise<{isNew: boolean, account_module: AccountModuleHydratedDocument}>
    deleteModule(name: string): Promise<IAccount>
}

export interface AccountQueryHelpers {
    //byOwnerUserId(userId: string): QueryWithHelpers<HydratedDocument<AccountModelType>, HydratedDocument<IAccount>, AccountQueryHelpers>
}

export type AccountModelType = Model<IAccount, AccountQueryHelpers, IAccountMethods>

export const AccountSchema: Schema<IAccount, AccountModelType> = new Schema(
    {
        owner_id: { type: Schema.Types.ObjectId, ref: DbModelsEnum.Managers, required: true },
        module_ids: { type: [Schema.Types.ObjectId], ref: DbModelsEnum.AccountModules, default: [] },
    },
    {
        query: {
        },
        methods: {
            getModules: async function(): Promise<AccountModuleHydratedDocument[]> {
                return ((await this.populate<{module_ids: IAccountModule[]}>('module_ids'))?.module_ids ?? []) as AccountModuleHydratedDocument[]
            },
            getModuleByName: async function(name: string): Promise<AccountModuleHydratedDocument|undefined> {
                return (await this.populate<{module_ids: IAccountModule[]}>('module_ids')).module_ids.find(m => m.name === name) as AccountModuleHydratedDocument|undefined
            },
            getModuleByNameOrCreate: async function(name: string): Promise<{isNew: boolean, account_module: AccountModuleHydratedDocument}> {
                const exists_module = (await this.populate<{module_ids: IAccountModule[]}>('module_ids')).module_ids.find(m => m.name === name)
                if (exists_module) {
                    return {
                        account_module: exists_module as AccountModuleHydratedDocument,
                        isNew: false
                    }
                } else {
                    const new_module = await AccountModule.create({ name, account_id: this._id })
                    this.module_ids.push(new_module.id)
                    await this.save()
                    return {
                        account_module: new_module as AccountModuleHydratedDocument,
                        isNew: true
                    }
                }
            },
            deleteModule: async function(name: string): Promise<IAccount> {
                const data_module = (await this.populate<{module_ids: IAccountModule[]}>('module_ids')).module_ids.find(m => m.name === name)
                if (data_module) {
                    this.module_ids = this.module_ids.filter(m => String(m) !== String(data_module._id))
                    await this.save()
                    await AccountModule.findByIdAndDelete(data_module._id)
                } else {
                    console.log("module not found")
                }
                return this
            }
        }
    }
);

export const Account = mongoose.model<IAccount, AccountModelType>(DbModelsEnum.Accounts, AccountSchema)
