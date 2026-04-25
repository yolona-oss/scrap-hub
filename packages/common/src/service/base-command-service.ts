import TypedEventEmitter, { EventMap } from 'typed-emitter'
import EventEmitter from 'events'

import { IRunnable } from "../types/runnable"

import { BLANK_SERVICE_NAME } from "./service-constants"
import { ServiceContext } from "./service-context"
import {
    IServiceStore,
    IServiceModuleHandle,
    IServiceSessionHandle,
    DEFAULT_ACCOUNT_SESSION_NAME,
    DEFAULT_SESSION_EXPIRITY_MS
} from "./service-store"

import {
    GlobalServiceConfig,
    GlobalServiceMessages,
    GlobalServiceParam,
    CmdServiceData,
    toDescriptor
} from "./service-data"

import { COMMAND_ARG_DESC_KEY, CommandMetadata, decodePositionalName, isEncodedPositionalName } from "../command"

import 'reflect-metadata'

export interface IntercomAction {
    id: string
    label: string
    icon?: string
    args?: string[]
}

/**
 * Typed event map for BaseCommandService. Subclasses get autocomplete +
 * type-check on every emit/on for these 8 kinds. The node-side invoke
 * adapter reads all of them off the emitter and forwards them as proto
 * InvokeServer messages.
 */
export interface IBaseCmdService_EvMap<T = string> extends EventMap {
    message: (msg: T) => void,
    error: (err: string) => void,
    done: (msg?: string) => void,
    liveLog: (logs: string[]) => void,
    progress: (name: string, current: number, total: number) => void,
    progressStatus: (name: string, status: string) => void,
    intercom: (actions: IntercomAction[]) => void,
    file: (handleOrPath: unknown) => void,
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
    private static _store: IServiceStore | null = null
    /** Wire once at app bootstrap. Hub sets a MongoServiceStore; node may set its own. */
    public static setStore(store: IServiceStore): void {
        BaseCommandService._store = store
    }
    /** Test-only escape hatch; safe to call from beforeEach to avoid cross-test pollution. */
    public static __resetStoreForTests(): void {
        BaseCommandService._store = null
    }
    private static requireStore(): IServiceStore {
        if (!BaseCommandService._store) {
            throw new Error('BaseCommandService has no store configured. Call BaseCommandService.setStore(...) during app bootstrap before any service runs.')
        }
        return BaseCommandService._store
    }

    private _isInited = false
    private _isRunning: boolean = false
    private _cachedModule: IServiceModuleHandle | null = null
    private _cachedSession: IServiceSessionHandle | null = null
    private _intercomActions: IntercomAction[] = []

    protected data: ServiceDataType

    /** Read-only view of the service's runtime data. The dispatcher's `/sinfo`
     *  built-in reads this to render runtime config/params/sessionData panels.
     *  External callers must not mutate; subclasses still have direct
     *  protected access via `this.data`. */
    get runtimeData(): Readonly<ServiceDataType> { return this.data }

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
        this.emit('intercom', [...this._intercomActions])
    }

    protected removeIntercom(actionId: string): void {
        this._intercomActions = this._intercomActions.filter(a => a.id !== actionId)
        this.emit('intercom', [...this._intercomActions])
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
            throw new Error(`Service already initialized`)
        }

        try {
            await this.initSession()
        } catch (e) {
            const msg = e instanceof Error ? e.message : e
            throw new Error(`Service initialization error:\n-- ${msg}`)
        }

        this._isInited = true
        console.info(`Service "${this.toString()}" initialized`)
    }

    private async retrieveAccountData(forceRefresh = false) {
        if (!forceRefresh && this._cachedModule && this._cachedSession) {
            return {
                module: this._cachedModule,
                session: this._cachedSession,
                session_data: this._cachedSession.data,
                module_data: this._cachedModule.data,
            }
        }

        const store = BaseCommandService.requireStore()
        const desiredSessionId = this.data.sessionId
        const { module, session } = await store.load({
            userId: this.userId,
            serviceName: this.name,
            desiredSessionId,
            defaultExpirityMs: DEFAULT_SESSION_EXPIRITY_MS,
            incrementalExpirity: true,
        })

        this._cachedModule = module
        this._cachedSession = session

        return {
            module,
            session,
            session_data: session.data,
            module_data: module.data,
        }
    }

    async initSession() {
        const inputData = this.inputServiceData
        const defaultData = this.defaultData
        const _session_id: string =
            inputData.params?.s || inputData.params?.sessionId || DEFAULT_ACCOUNT_SESSION_NAME
        this.data.sessionId = _session_id
        this.data.params = { ...this.data.params, ...inputData.params }

        const { session_data, module_data, session, module } = await this.retrieveAccountData(true)

        // Decode positional args (positional-1-query → query)
        const decodedInputConfig: Record<string, unknown> = {}
        if (inputData.config) {
            const configBag = inputData.config as Record<string, unknown>
            for (const key of Object.keys(configBag)) {
                if (isEncodedPositionalName(key)) {
                    const { name } = decodePositionalName(key)
                    decodedInputConfig[name] = configBag[key]
                } else {
                    decodedInputConfig[key] = configBag[key]
                }
            }
        }

        let aConfig = {
            ...defaultData.config,
            ...(module_data.config ?? {}),
            ...decodedInputConfig,
        }
        await module.replaceConfig(aConfig as Record<string, unknown>)

        let aSessionData = session_data
        if (!aSessionData || Object.keys(aSessionData).length === 0) {
            aSessionData = {
                ...defaultData.sessionData,
                ...(inputData.sessionData ?? {}),
            } as Record<string, unknown>
            await session.replaceData(aSessionData)
        }

        this.data = {
            config: aConfig,
            sessionData: aSessionData,
            sessionId: session.name,
            messages: defaultData.messages,
            params: defaultData.params,
        } as ServiceDataType
    }

    protected async setConfigValue(path: string, value: any) {
        const { module } = await this.retrieveAccountData()
        const prefix = `config${path.length > 0 ? "." : ""}`
        await module.setField(`${prefix}${path}`, value)
    }

    protected async setSessionDataValue(path: string, value: any) {
        const { session } = await this.retrieveAccountData()
        await session.setField(path, value)
    }

    async run(): Promise<void> {
        if (!this._isInited) {
            throw new Error(`Service not initialized`)
        }
        if (this.isRunning()) {
            throw new Error(`Service already running`)
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
