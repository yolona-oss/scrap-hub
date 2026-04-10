import mongoose, { Document, HydratedDocument, HydratedDocumentFromSchema, Model, QueryWithHelpers, Schema } from "mongoose";
import { DbModelsEnum } from "@core/db/models-enum";
import { AccountModelType } from "./account";
import { AccountSession, AccountSessionHydratedDocument, DEFAULT_ACCOUNT_SESSION_NAME, IAccountSession, IAccountSessionCreateDto, IAccountSessionCtrl } from "./session";
import { UiUnicodeSymbols } from "@core/ui";

export interface IAccountModuleCreateDto {
    name: string,
    data: any,
    account_id: string
}

export interface IAccountModule extends Document {
    name: string
    data: any
    account_id: Schema.Types.ObjectId
    session_ids: Schema.Types.ObjectId[]
}

export interface IAccountModuleQueryHelpers {
    byName(account_id: string, module_name: string): QueryWithHelpers<
        HydratedDocument<IAccountModule>[],
        HydratedDocument<IAccountModule>,
        IAccountModuleQueryHelpers
    >
}

export interface IAccountModuleMethods {
    getSessions(): Promise<AccountSessionHydratedDocument[]>
    getSession(name: string): Promise<AccountSessionHydratedDocument|undefined>
    createAndApplySession(dto: IAccountSessionCreateDto): Promise<AccountSessionHydratedDocument>
}

export type AccountModuleModelType = Model<IAccountModule, IAccountModuleQueryHelpers, IAccountModuleMethods>
export type AccountModuleHydratedDocument = HydratedDocumentFromSchema<typeof AccountModuleSchema>

export const AccountModuleSchema: Schema<IAccountModule, AccountModelType, IAccountModuleMethods, IAccountModuleQueryHelpers> = new Schema({
    name: { type: String, required: true, readonly: true },
    data: { type: Schema.Types.Mixed, required: false, default: {} },

    session_ids: { type: [Schema.Types.ObjectId], ref: DbModelsEnum.AccountSessions, required: false, default: [] },
    account_id: { type: Schema.Types.ObjectId, ref: DbModelsEnum.Accounts, required: true },
},
    {
        timestamps: true,
        methods: {
            getSessions: async function(): Promise<AccountSessionHydratedDocument[]> {
                return ((await this.populate<{session_ids: IAccountSession[]}>('session_ids')).session_ids ?? []) as AccountSessionHydratedDocument[]
            },
            getSession: async function(name: string): Promise<AccountSessionHydratedDocument|undefined> {
                return (await this.getSessions()).find(s => s.name === name)
            },
            createAndApplySession: async function(dto: IAccountSessionCreateDto): Promise<AccountSessionHydratedDocument> {
                const { name } = dto
                const realname = name || DEFAULT_ACCOUNT_SESSION_NAME
                if (!isValidModuleName(realname)) {
                    throw new Error(`${UiUnicodeSymbols.error} Invalid session name: "${realname}"`)
                }
                if (realname !== DEFAULT_ACCOUNT_SESSION_NAME && (await this.getSessions()).find(s => s.name === realname)) {
                    throw new Error(`${UiUnicodeSymbols.error} Session name: "${realname}" already exists`)
                }
                const createDto = {...dto, name: realname}
                const newSession = await AccountSession.create(createDto)
                this.session_ids.push(newSession.id)
                await this.save()
                return newSession
            }
        },
        query: {
            byName(this: AccountModuleModelType, account_id: string, module_name: string) {
                return this.find({ account_id, name: module_name })
            },
        }
    }
);

export const AccountModule = mongoose.model<IAccountModule, AccountModuleModelType>(DbModelsEnum.AccountModules, AccountModuleSchema)

function isValidModuleName(name: string): boolean {
    return Boolean(name.match(/^[\:a-zA-Z0-9_]+$/))
}

AccountModuleSchema.pre('save', function(next) {
    if (!isValidModuleName(this.name)) {
        next(new Error('Invalid module name'))
    }
})
