import { DbModelsEnum } from '@core/db/models-enum';
//import { extractValueFromObject, removeFieldFromObject } from '@core/utils/object'
import mongoose, { Schema, Document, Model } from 'mongoose';
import { HydratedDocumentFromSchema } from 'mongoose';

export const DEFAULT_ACCOUNT_SESSION_NAME = "default_session"
export const DEFAULT_INCREMENTAL_EXPIRITY_OPT = true
export const DEFAULT_SERVICE_SESSION_EXPIRITY = 1000 * 60 * 60 * 24 * 2 // 2 days

export const CreateDefaultServiceSessionData: () => IAccountSession = () => {
    return {
        createTime: Date.now(),
        expirity: DEFAULT_SERVICE_SESSION_EXPIRITY,
        initialExpirity: DEFAULT_SERVICE_SESSION_EXPIRITY,
        incrementalExpirity: DEFAULT_INCREMENTAL_EXPIRITY_OPT
    } as IAccountSession
}

// TODO rename
export interface IAccountSessionCtrl {
    createTime: number // 
    expirity: number // end on createTime+expirity
    initialExpirity: number // intial expirity that value will be added to expirity if incrementalExpirity is true
    incrementalExpirity: boolean // if true - every time when service run with new expirity
}

export interface IAccountSession extends IAccountSessionCtrl, Document {
    name: string
    //dataJson?: string
    data: any
}

export interface IAccountSessionCreateDto {
    name?: string,
    expirity: number,
    incrementalExpirity: boolean

    data?: any
}

interface IAccountSessionMethods {
    isDefault(): boolean
    isExpired(): boolean,
    extendExpirity(addTime: number): Promise<AccountSessionHydratedDocument>
    incrementExpirity(): Promise<AccountSessionHydratedDocument>
    //readData<T = any>(path: string): T
    //appendData(obj: any): Promise<IAccountSession>
    //dropData(): Promise<IAccountSession>
    //removeData(path: string): Promise<IAccountSession>
}

type AccountSessionModelType = Model<IAccountSession, {}, IAccountSessionMethods>
export type AccountSessionHydratedDocument = HydratedDocumentFromSchema<typeof AccountSessionSchema>

export const AccountSessionSchema: Schema<IAccountSession, AccountSessionModelType, IAccountSessionMethods> = new Schema({
    name: { type: String, required: false, default: DEFAULT_ACCOUNT_SESSION_NAME, readonly: true },
    createTime: { type: Number, required: false, default: Date.now },
    expirity: { type: Number, required: true },
    initialExpirity: { type: Number, required: false, default: 0 },
    incrementalExpirity: { type: Boolean, required: false, default: DEFAULT_INCREMENTAL_EXPIRITY_OPT },

    data: { type: Schema.Types.Mixed, required: false, default: {} },
},
    {
        methods: {
            isDefault: function(): boolean {
                return this.name === DEFAULT_ACCOUNT_SESSION_NAME
            },
            isExpired: function(): boolean {
                if (this.createTime + this.expirity < Date.now()) {
                    return true
                }
                return false
            },
            extendExpirity: async function(addTime: number): Promise<AccountSessionHydratedDocument> {
                // TODO validate addTime
                if (addTime <= 0) {
                    throw new Error("AccountSessionSchema::extendExpirity addTime must be greater than 0")
                }
                this.expirity += addTime
                await this.save()
                return this
            },
            incrementExpirity: async function(): Promise<AccountSessionHydratedDocument> {
                this.expirity += this.initialExpirity
                await this.save()
                return this
            },
            //readData: function(path: string) {
            //    const parsed = JSON.parse(this.dataJson ?? "{}")
            //    return extractValueFromObject(parsed, path)
            //},
            //appendData: async function(obj: any) {
            //    if (obj == null) {
            //        throw new Error("AccountSessionSchema::appendData Cannot append null object")
            //    }
            //
            //    const parsed = JSON.parse(this.dataJson ?? "{}")
            //    Object.assign(parsed, obj)
            //    this.dataJson = JSON.stringify(parsed)
            //
            //    await this.save()
            //
            //    return this
            //},
            //dropData: async function() {
            //    this.dataJson = "{}"
            //    await this.save()
            //    return this
            //},
            //removeData: async function(path: string) {
            //    let parsed = JSON.parse(this.dataJson ?? "{}")
            //    removeFieldFromObject(parsed, path)
            //    this.dataJson = JSON.stringify(parsed)
            //    await this.save()
            //    return this
            //}
        }
    }
);

export const AccountSession = mongoose.model<IAccountSession, AccountSessionModelType>(DbModelsEnum.AccountSessions, AccountSessionSchema)

AccountSessionSchema.pre("save", function(next) {
    if (this.isNew) {
        this.initialExpirity = this.expirity
    }
    if (next && typeof next === "function") {
        next()
    }
})
