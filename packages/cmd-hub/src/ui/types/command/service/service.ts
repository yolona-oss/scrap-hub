import { Account, Manager } from "@core/db"
import { IRunnable } from "@core/types/runnable"
import TypedEventEmitter, { EventMap } from 'typed-emitter'
import EventEmitter from 'events'

import { BLANK_SERVICE_NAME } from "./constants"
import { ServiceContext } from "./context"
import { DEFAULT_ACCOUNT_SESSION_NAME } from "@core/db/schemes/account/session"

import {
    GlobalServiceConfig,
    GlobalServiceMessages,
    GlobalServiceParam,
    CmdServiceData,
    toDescriptor
} from "./data"

import { CmdArgument, COMMAND_ARG_DESC_KEY, CommandMetadata, decodePositionalName } from "@core/ui/types/command"
import { Extender } from "@core/utils/extender"

import 'reflect-metadata'
import { UiUnicodeSymbols } from "@core/ui"
import { log } from '@logger'

export interface IntercomAction {
    id: string
    label: string
    icon?: string
    args?: string[]
}

interface IBaseCmdService_EvMap<T = string> extends EventMap {
    message: (msg: T) => void,
    error: (err: string) => void,
    done: (msg?: string) => void,
    liveLog: (logs: string[]) => void
}

function applyMixins(derivedCtor: any, baseCtors: any[]) {
    baseCtors.forEach(baseCtor => {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(name => {
            Object.defineProperty(derivedCtor.prototype, name, Object.getOwnPropertyDescriptor(baseCtor.prototype, name)!);
        });
    });
}

function merge<T extends Object>(dst: T, src: T): T {
    const merged = Object.create(Object.getPrototypeOf(dst));

    Object.assign(merged, dst, src);

    const dst_meta = Reflect.getMetadata(COMMAND_ARG_DESC_KEY, dst);
    if (dst_meta) {
        Reflect.defineMetadata(COMMAND_ARG_DESC_KEY, dst_meta, merged);
    }

    const src_meta = Reflect.getMetadata(COMMAND_ARG_DESC_KEY, src);
    if (src_meta) {
        const existingMetadata = Reflect.getMetadata(COMMAND_ARG_DESC_KEY, merged) || {};
        Reflect.defineMetadata(COMMAND_ARG_DESC_KEY, { ...existingMetadata, ...src_meta }, merged);
    }

    return merged;
}

/**
 * Base class for command services
 * @template ServiceDataType - Type of service data not extended from base. See {@link CmdServiceData}
 */
export abstract class BaseCommandService<ServiceDataType extends CmdServiceData<any, any, any, any>>
    extends (EventEmitter as new () => TypedEventEmitter<IBaseCmdService_EvMap>)
    implements IRunnable
{
    private _isInited = false
    private _isRunning: boolean = false
    private _cachedAccountModule: any = null
    private _cachedAccountSession: any = null
    private _intercomActions: IntercomAction[] = []

    protected data: ServiceDataType

    constructor(
        protected userId: string,
        private defaultData: ServiceDataType,
        private inputServiceData: Partial<ServiceDataType>,
        public readonly name: string = BLANK_SERVICE_NAME,
    ) {
        super()
        this.data = defaultData
        const g_conf  = new GlobalServiceConfig
        const g_param = new GlobalServiceParam
        const g_msgs  = new GlobalServiceMessages

        this.data.config = merge(this.data.config, g_conf)
        this.data.params = merge(this.data.params, g_param)
        this.data.messages = merge(this.data.messages, g_msgs)

        console.log(`--------#${this.name}#--------`)
        console.log(this.data)
        //deepMerge(frame, inputServiceData)
    }

    protected abstract runWrapper(): Promise<void>
    protected abstract terminateWrapper(): Promise<void>
    abstract receiveMsg(msg: string, args: string[]): Promise<void>
    abstract clone(userId: string, input?: Partial<ServiceDataType>, newName?: string): BaseCommandService<ServiceDataType>

    protected sendToWorld(msg: string) {
        this.emit("message", msg)
    }

    //protected initLiveLog() {
    //
    //}

    // protected sendToLiveLog(objId: string, msg: string) {
    // }

    protected sendToError(msg: string) {
        this.emit("error", msg)
    }

    /**
     * Register a custom action button on the dashboard.
     * The button click triggers receiveMsg(action.id, action.args ?? []).
     */
    protected registerIntercom(action: IntercomAction): void {
        const existing = this._intercomActions.findIndex(a => a.id === action.id)
        if (existing >= 0) {
            this._intercomActions[existing] = action
        } else {
            this._intercomActions.push(action)
        }
        this.emit('intercom' as any, [...this._intercomActions])
    }

    protected removeIntercom(actionId: string): void {
        this._intercomActions = this._intercomActions.filter(a => a.id !== actionId)
        this.emit('intercom' as any, [...this._intercomActions])
    }

    get intercomActions(): ReadonlyArray<IntercomAction> {
        return this._intercomActions
    }

    protected getServiceContext(): ServiceContext {
        return {
            userId: this.userId,
            serviceName: this.name,
            sessionId: this.data.sessionId,
            config: this.data.config as Record<string, any>,
        }
    }

    protected createServicePrefix() {
        return `${this.name}-${this.data.sessionId}-${this.userId}`
    }

    public get SessionId() {
        return this.data.sessionId
    }

    get isBlankSession() {
        return this.data.sessionId === DEFAULT_ACCOUNT_SESSION_NAME
    }

    isRunning(): boolean {
        return this._isRunning
    }

    configDescriptor(): CommandMetadata {
        return {
            ...toDescriptor(new GlobalServiceConfig),
            ...toDescriptor(this.data.config)
        }
    }

    paramsDescriptor(): CommandMetadata {
        return {
            ...toDescriptor(new GlobalServiceParam),
            ...toDescriptor(this.data.params)
        }
    }

    receiveMsgDescriptor(): CommandMetadata {
        return {
            ...toDescriptor(new GlobalServiceMessages),
            ...toDescriptor(this.data.messages)
        }
    }

    toString() {
        return `_${this.name}_-_${this.data.sessionId}_`
    }

    async Initialize(): Promise<void> {
        if (this._isInited) {
            throw new Error(`${UiUnicodeSymbols.error} Service already initialized`)
        }

        try {
            await this.initSession()
        } catch (e) {
            const msg = e instanceof Error ? e.message : e
            throw new Error(`${UiUnicodeSymbols.error} Service initialization error:\n-- ${msg}`)
        }

        this._isInited = true
        log.info(`Service "${this.toString()}" initialized`)
    }

    private async retrieveAccountData(forceRefresh = false) {
        if (!forceRefresh && this._cachedAccountModule && this._cachedAccountSession) {
            return {
                account_module_session: this._cachedAccountSession,
                account_module: this._cachedAccountModule,
                session_data: this._cachedAccountSession.data,
                module_data: this._cachedAccountModule.data
            }
        }

        const owner = (await Manager.findOne({userId: this.userId}))!
        const account = (await Account.findById(owner.account))!

        const sessionId = this.data.sessionId
        const {isNew, account_module} = await account.getModuleByNameOrCreate(this.name)
        const moduleAttachedSessions = await account_module.getSessions()
        let account_module_session = moduleAttachedSessions.find(s => s.name === sessionId)
        if (isNew || !account_module_session) {
            const new_session = await account_module.createAndApplySession({
                name: sessionId,
                expirity: Extender.stringToMs("1d"),
                incrementalExpirity: true
            })
            account_module_session = new_session
        }

        if (!account_module_session) {
            throw new Error("Cannot handle account module session creation/assigning")
        }

        this._cachedAccountModule = account_module
        this._cachedAccountSession = account_module_session

        return {
            account_module_session,
            account_module,
            session_data: account_module_session.data,
            module_data: account_module.data
        }
    }

    async initSession() {

        // load config and session data

        const inputData = this.inputServiceData
        const defaultData = this.defaultData
        const _session_id: string = inputData.params?.s || inputData.params?.sessionId || DEFAULT_ACCOUNT_SESSION_NAME
        this.data.sessionId = _session_id
        this.data.params = {
            ...this.data.params,
            ...inputData.params
        }

        const { session_data, module_data, account_module_session, account_module } = await this.retrieveAccountData(true)

        // Decode positional argument names (e.g. "positional-1-query" → "query")
        const decodedInputConfig: any = {}
        if (inputData.config) {
            for (const key in inputData.config) {
                if (key.startsWith('positional-')) {
                    const { name } = decodePositionalName(key)
                    decodedInputConfig[name] = (inputData.config as any)[key]
                } else {
                    decodedInputConfig[key] = (inputData.config as any)[key]
                }
            }
        }

        // Always merge: defaults ← DB config ← user input (input wins)
        let aConfig = {
            ...defaultData.config,
            ...(module_data.config ?? {}),
            ...decodedInputConfig,
        }
        account_module.set("data.config", aConfig)
        await account_module.save()

        let aSessionData = session_data
        if (!aSessionData) {
            aSessionData = {
                ...defaultData.sessionData,
                ...inputData.sessionData ?? {}
            }
            account_module_session.set("data", aSessionData)
            await account_module_session.save()
        }

        this.data = {
            config: aConfig,
            sessionData: aSessionData,
            sessionId: account_module_session.name,
            messages: defaultData.messages,
            params: defaultData.params,
        } as ServiceDataType
    }

    protected async setConfigValue(path: string, value: any) {
        const { account_module } = await this.retrieveAccountData()
        const prefix = `data.config${path.length > 0 ? "." : ""}`
        account_module.set(`${prefix}${path}`, value)
        await account_module.save()
    }

    protected async setSessionDataValue(path: string, value: any) {
        const { account_module_session } = await this.retrieveAccountData()
        const prefix = `data${path.length > 0 ? "." : ""}`
        account_module_session.set(`${prefix}${path}`, value)
        await account_module_session.save()
    }

    async run(): Promise<void> {
        if (!this._isInited) {
            throw new Error(`${UiUnicodeSymbols.error} Service not initialized`)
        }
        if (this.isRunning()) {
            throw new Error(`${UiUnicodeSymbols.error} Service already running`)
        }

        this._isRunning = true

        await this.runWrapper()

        // If runWrapper finishes naturally (not via terminate()), auto-terminate
        if (this._isRunning) {
            await this.terminate()
        }
    }

    async terminate(): Promise<void> {
        await this.terminateWrapper()
        this._isRunning = false
        this.emit("done")
    }
}
