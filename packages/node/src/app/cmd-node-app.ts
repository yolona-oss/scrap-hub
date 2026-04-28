import { z } from 'zod'
import { EventEmitter } from 'events'
import {
    Application,
    ApplicationOptions,
    AppMiddleware,
    BaseCommandService,
    CAP_ServiceStore,
    ConfigContributor,
    CommandRegistration,
    Phase,
    log,
    buildCommandFromDecorator,
    buildProtoArgsFromDataClass,
    getCmdServiceMeta,
    getCmdOneShotMeta,
    bindArgsForSpec,
    makeCmdOneShotContext,
    CommandArgumentHolder,
    CmdOneShotSpec,
    uiMessageKindCap,
    type BranchedOptionsTree,
} from '@cmd-hub/common'
import { CmdHubProto } from '@cmd-hub/transport'
import { hardwareInfo } from '../manifest/hardware-info'
import type { IExecutor, RunnableService } from '../runtime/invoke-server'
import { CAP_NodeManifest, CAP_NodeExecutor } from '../capabilities'

type NodeManifest = CmdHubProto.NodeManifest
type ProtoCommand = CmdHubProto.Command
type ProtoArgSpec = CmdHubProto.ArgSpec
type InvokeStart = CmdHubProto.InvokeStart

interface HubConfigFragment {
    hub?: Record<'nodeId' | 'nodeName' | 'version', unknown>
}

export interface ServiceConstructorInput {
    config: unknown
    params: unknown
    messages: unknown
    sessionId: string
    sessionData: Record<string, unknown>
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceClass = new (...args: any[]) => RunnableService

export interface ServiceClassWithOptionalConfig extends ServiceClass {
    configNamespace?: string
    configSchema?: z.ZodType<unknown>
}

export type CmdRegistrable = ServiceClassWithOptionalConfig | CmdOneShotSpec

export interface CmdNodeAppOptions<Cfg>
    extends Omit<ApplicationOptions<Cfg>, 'baseSchema'> {
    baseSchema?: ApplicationOptions<Cfg>['baseSchema']
    nodeId?: string
    nodeName?: string
    version?: string
}

/** Drop the `standalone` field so the result lines up with `CmdHubProto.ArgSpec`,
 *  and translate the in-memory `branchedOptions` tree into the proto's
 *  `BranchedOptions` recursive shape. */
function toProtoArgs(args: ReadonlyArray<{
    name: string
    position: number
    required: boolean
    type: string
    description: string
    enumValues: string[]
    defaultValue: string
    branchedOptions?: BranchedOptionsTree
}>): ProtoArgSpec[] {
    return args.map((a) => ({
        name: a.name,
        position: a.position,
        required: a.required,
        type: a.type,
        description: a.description,
        enumValues: a.enumValues,
        defaultValue: a.defaultValue,
        branchedOptions: a.branchedOptions ? treeToProto(a.branchedOptions) : undefined,
    }))
}

function treeToProto(tree: BranchedOptionsTree): CmdHubProto.BranchedOptions {
    const branches: { [key: string]: CmdHubProto.BranchedOptions } = {}
    for (const [name, child] of Object.entries(tree.branches)) {
        branches[name] = treeToProto(child)
    }
    return { leaves: tree.leaves, branches }
}

/** Wraps a `CmdOneShotSpec` as a `RunnableService` so the
 *  executor/event-adapter pipeline works unchanged. */
function makeOneShotService(
    spec: CmdOneShotSpec,
    start: InvokeStart,
    app: Application<unknown>,
): RunnableService {
    const ee = new EventEmitter()
    const ctx = makeCmdOneShotContext({
        args: bindArgsForSpec(spec, start.args),
        userId: start.userId,
        sessionId: start.sessionId,
        registry: app,
        emit: (event) => {
            // Translate the OneShot context's free-form text events into
            // the unified `uiMessage` channel — there's no legacy text
            // event on the service emitter anymore.
            if (event.kind === 'message') {
                ee.emit('uiMessage', { kind: 'text', text: event.text })
            } else {
                ee.emit('uiMessage', { kind: 'text', text: event.text, severity: 'error' })
            }
        },
    })

    return {
        on: ee.on.bind(ee),
        off: ee.off.bind(ee),
        emit: ee.emit.bind(ee),
        async receiveMsg(_id: string, _args: string[]): Promise<void> { /* one-shot: no intercom */ },
        async run(): Promise<void> {
            try {
                await spec.invokable(ctx)
                ee.emit('done', '')
            } catch (e: unknown) {
                const text = e instanceof Error ? e.message : String(e)
                ee.emit('uiMessage', { kind: 'text', text, severity: 'error' })
                ee.emit('done', '')
            }
        },
    }
}

/** Node-side Application: register `@CmdService`/`@CmdOneShot` classes or
 *  `CmdOneShot({...})` specs via `.useCommand(...)`, wire HubClient +
 *  InvokeServer middlewares, then `Initialize()`/`run()`. */
export class CmdNodeApp<Cfg = unknown> extends Application<Cfg> {
    private readonly _nodeIdOverride?: string
    private readonly _nodeNameOverride?: string
    private readonly _versionOverride?: string

    private readonly _serviceClasses: Map<string, ServiceClassWithOptionalConfig> = new Map()
    private readonly _functionCommands: Map<string, CmdOneShotSpec> = new Map()
    private _cachedManifest: NodeManifest | null = null

    constructor(opts: CmdNodeAppOptions<Cfg>) {
        const baseSchema: z.ZodType<unknown> = opts.baseSchema ?? z.object({}).passthrough()
        super({
            configPath: opts.configPath,
            baseSchema,
            inlineConfig: opts.inlineConfig,
            name: opts.name ?? (opts.nodeId ? `cmd-node-${opts.nodeId}` : 'cmd-node'),
        })
        this._nodeIdOverride = opts.nodeId
        this._nodeNameOverride = opts.nodeName
        this._versionOverride = opts.version
    }

    get nodeId(): string {
        return this._nodeIdOverride ?? this._requireHubField('nodeId')
    }
    get nodeName(): string {
        return this._nodeNameOverride ?? this._requireHubField('nodeName')
    }
    get nodeVersion(): string {
        return this._versionOverride ?? this._requireHubField('version')
    }

    private _requireHubField(key: 'nodeId' | 'nodeName' | 'version'): string {
        const cfg = this.config
        const hub = (cfg !== null && typeof cfg === 'object')
            ? (cfg as HubConfigFragment).hub
            : undefined
        const v = hub?.[key]
        if (typeof v !== 'string' || v.length === 0) {
            throw new Error(
                `CmdNodeApp: config.hub.${key} is missing — either pass it via constructor opts or declare it in config.json`,
            )
        }
        return v
    }

    useCommand(reg: CmdRegistrable): this {
        if (typeof reg === 'object' && typeof (reg as CmdOneShotSpec).invokable === 'function') {
            this._registerOneShot(reg as CmdOneShotSpec)
            return this
        }

        const cmdMeta = getCmdOneShotMeta(reg)
        if (cmdMeta) {
            this._registerOneShot(cmdMeta)
            return this
        }

        const cls = reg as ServiceClassWithOptionalConfig
        const meta = getCmdServiceMeta(cls)
        if (!meta) {
            throw new Error(
                `CmdNodeApp.useCommand: ${cls.name ?? '(anon)'} is not decorated with @CmdService or @CmdOneShot`,
            )
        }
        if (this._serviceClasses.has(meta.name) || this._functionCommands.has(meta.name)) {
            throw new Error(`CmdNodeApp.useCommand: duplicate command name "${meta.name}"`)
        }
        this._serviceClasses.set(meta.name, cls)
        this._cachedManifest = null
        return this
    }

    useCommands(arr: CmdRegistrable[]): this {
        for (const reg of arr) this.useCommand(reg)
        return this
    }

    private _registerOneShot(spec: CmdOneShotSpec): void {
        if (this._functionCommands.has(spec.name) || this._serviceClasses.has(spec.name)) {
            throw new Error(`CmdNodeApp.useCommand: duplicate command name "${spec.name}"`)
        }
        this._functionCommands.set(spec.name, spec)
        this._cachedManifest = null
    }

    get services(): ReadonlyMap<string, ServiceClassWithOptionalConfig> {
        return this._serviceClasses
    }

    get functionCommands(): ReadonlyMap<string, CmdOneShotSpec> {
        return this._functionCommands
    }

    async buildManifest(): Promise<NodeManifest> {
        const commands: ProtoCommand[] = []
        for (const [, cls] of this._serviceClasses) {
            const cmd = await buildCommandFromDecorator(cls)
            const meta = getCmdServiceMeta(cls)
            commands.push({
                name: cmd.name,
                compatibilityId: cmd.compatibilityId,
                version: cmd.version,
                description: cmd.description,
                args: toProtoArgs(cmd.args),
                aliases: cmd.aliases,
                requires: (meta?.requires ?? []).map(k => k as string),
            })
        }
        for (const [, spec] of this._functionCommands) {
            const args = spec.argsClass
                ? toProtoArgs(await buildProtoArgsFromDataClass(spec.argsClass, spec.name))
                : []
            commands.push({
                name: spec.name,
                compatibilityId: spec.compatibilityId,
                version: spec.version,
                description: spec.description,
                args,
                aliases: [],
                requires: (spec.requires ?? []).map(k => k as string),
            })
        }
        return {
            nodeId: this.nodeId,
            nodeName: this.nodeName,
            version: this.nodeVersion,
            commands,
            services: commands.map((c) => ({
                command: c,
                intercomActions: [],
                caps: { supportsPause: false, supportsStop: true },
            })),
            configs: [],
            hardware: hardwareInfo(),
            metrics: { gauges: [], counters: [], histograms: [] },
            publishedCapabilities: [
                ...this.manifestSnapshot().capabilities.map(c => c.key),
                // One cap per UiMessage kind this node may emit. UIs whose
                // `federationRequires.supported` lists matching caps render
                // those kinds natively; UIs missing a kind get a warning at
                // attach time and the dashboard falls back to text.
                ...this.nodeUiMessageRegistry.registeredKinds().map(kind => uiMessageKindCap(kind) as string),
            ],
        }
    }

    protected buildExecutor(): IExecutor {
        const serviceClasses = this._serviceClasses
        const functionCommands = this._functionCommands
        const getCachedManifest = (): NodeManifest => {
            if (!this._cachedManifest) {
                throw new Error(
                    'CmdNodeApp.executor.getManifest: manifest not yet built — ' +
                    'Initialize() must complete before the executor handles RPCs',
                )
            }
            return this._cachedManifest
        }
        const app = this

        return {
            async createService(start: InvokeStart): Promise<RunnableService> {
                const fnSpec = functionCommands.get(start.commandName)
                if (fnSpec) {
                    return makeOneShotService(fnSpec, start, app)
                }
                const cls = serviceClasses.get(start.commandName)
                if (!cls) {
                    throw new Error(`no service registered for command "${start.commandName}"`)
                }
                const meta = getCmdServiceMeta(cls)!
                const config = CommandArgumentHolder.fromMap(meta.config, start.args)
                const params = CommandArgumentHolder.fromMap(meta.params, start.args)
                const messages = CommandArgumentHolder.fromMap(meta.messages, start.args)
                const input: ServiceConstructorInput = {
                    config, params, messages,
                    sessionId: start.sessionId,
                    sessionData: {},
                }
                // `name` is persisted into `account_modules.name` as a string,
                // so pass the registered command name (not `input`).
                return new cls(start.userId, input, start.commandName)
            },
            getManifest(): NodeManifest {
                return getCachedManifest()
            },
        }
    }

    protected _collectSubclassContributors(): ConfigContributor[] {
        const out: ConfigContributor[] = []
        const seen = new Set<string>()
        for (const [, cls] of this._serviceClasses) {
            const ns = cls.configNamespace
            const schema = cls.configSchema
            if (!ns || !schema) continue
            // Duplicates fall through; Application._buildMergedSchema reports them.
            seen.add(ns)
            out.push({ namespace: ns, schema })
        }
        return out
    }

    protected _collectRegisteredCommands(): CommandRegistration[] {
        const out: CommandRegistration[] = []
        for (const [, cls] of this._serviceClasses) {
            const meta = getCmdServiceMeta(cls)
            if (!meta) continue
            out.push({
                name: meta.name,
                requires: (meta.requires ?? []).map(k => k as string),
            })
        }
        for (const [, spec] of this._functionCommands) {
            out.push({
                name: spec.name,
                requires: (spec.requires ?? []).map(k => k as string),
            })
        }
        return out
    }

    async Initialize(): Promise<void> {
        this.provide(CAP_NodeExecutor, this.buildExecutor())
        // Manifest is built at BeforeServices, after Storage/Transport caps
        // have published — building earlier would ship an empty
        // publishedCapabilities and break UI federationRequires checks.
        this._installManifestRefreshHook()
        await super.Initialize()
    }

    private _installManifestRefreshHook(): void {
        const refresh: AppMiddleware = {
            name: 'CmdNodeAppManifestRefresh',
            phase: Phase.BeforeServices,
            install: async (app) => {
                this._cachedManifest = await this.buildManifest()
                this.provide(CAP_NodeManifest, this._cachedManifest)
                log.info(
                    `CmdNodeAppManifestRefresh: refreshed CAP_NodeManifest with ` +
                    `${this._cachedManifest.publishedCapabilities.length} published caps`,
                )
                const store = app.get(CAP_ServiceStore)
                if (store) {
                    BaseCommandService.setStore(store)
                    log.info('CmdNodeAppManifestRefresh: wired BaseCommandService.setStore from CAP_ServiceStore')
                }
            },
        }
        this.use(refresh)
    }

    async run(): Promise<void> {
        // Passive: driven by incoming gRPC streams until terminate().
        await new Promise<void>(() => {})
    }

    async getManifest(): Promise<NodeManifest> {
        return this._cachedManifest ?? (await this.buildManifest())
    }
}
