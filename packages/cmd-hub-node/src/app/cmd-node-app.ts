import { z } from 'zod'
import {
    Application,
    ApplicationOptions,
    ConfigContributor,
    buildCommandFromDecorator,
    getCmdServiceMeta,
    CommandArgumentHolder,
} from '@cmd-hub/common'
import { CmdHubProto } from '@cmd-hub/transport'
import { hardwareInfo } from '../manifest/hardware-info'
import type { IExecutor, RunnableService } from '../runtime/invoke-server'

type NodeManifest = CmdHubProto.NodeManifest
type ProtoCommand = CmdHubProto.Command
type ProtoArgSpec = CmdHubProto.ArgSpec
type InvokeStart = CmdHubProto.InvokeStart

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ServiceClass = new (...args: any[]) => RunnableService

/**
 * Hub-registered service class. Decorated with `@CmdService` and optionally
 * carrying `static configNamespace` / `static configSchema` for per-service
 * config contribution.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ServiceClassWithOptionalConfig extends ServiceClass {
    configNamespace?: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    configSchema?: z.ZodType<any>
}

export interface CmdNodeAppOptions<Cfg>
    extends Omit<ApplicationOptions<Cfg>, 'baseSchema'> {
    baseSchema?: ApplicationOptions<Cfg>['baseSchema']
    /** Node identity + runtime version used when building the manifest. */
    nodeId: string
    nodeName: string
    version: string
}

/**
 * Strip the extra `standalone` field added by `buildCommandFromDecorator` so
 * the proto-layer `ArgSpec` lines up exactly with `CmdHubProto.ArgSpec`.
 */
function toProtoArgs(args: { name: string; position: number; required: boolean; type: string; description: string; enumValues: string[]; defaultValue: string }[]): ProtoArgSpec[] {
    return args.map((a) => ({
        name: a.name,
        position: a.position,
        required: a.required,
        type: a.type,
        description: a.description,
        enumValues: a.enumValues,
        defaultValue: a.defaultValue,
    }))
}

/**
 * Node-side Application subclass. Users call `.useCommand(ServiceClass)` to
 * register `@CmdService`-decorated classes, then `.use(new HubClientMiddleware(...))`
 * and `.use(new InvokeServerMiddleware(...))` to wire the network pieces.
 *
 * During `Initialize()` we build the manifest + executor from the registered
 * service classes and stash them on the instance BEFORE `super.Initialize()`
 * so the middlewares can pick them up during their `install()` calls.
 */
export class CmdNodeApp<Cfg = unknown> extends Application<Cfg> {
    public readonly nodeId: string
    public readonly nodeName: string
    public readonly nodeVersion: string

    private readonly _serviceClasses: Map<string, ServiceClassWithOptionalConfig> = new Map()
    private _cachedManifest: NodeManifest | null = null

    constructor(opts: CmdNodeAppOptions<Cfg>) {
        if (!opts.nodeId) throw new Error('CmdNodeApp: nodeId is required')
        if (!opts.nodeName) throw new Error('CmdNodeApp: nodeName is required')
        if (!opts.version) throw new Error('CmdNodeApp: version is required')
        super({
            configPath: opts.configPath,
            baseSchema: opts.baseSchema ?? (z.object({}).passthrough() as unknown as z.ZodType<unknown>),
            inlineConfig: opts.inlineConfig,
            name: opts.name ?? `cmd-node-${opts.nodeId}`,
        })
        this.nodeId = opts.nodeId
        this.nodeName = opts.nodeName
        this.nodeVersion = opts.version
    }

    /**
     * Register a `@CmdService`-decorated service class. Fails loudly on a
     * duplicate command name — service authors who want multiple instances
     * of the "same" command should give them distinct @CmdService names.
     */
    useCommand(cls: ServiceClassWithOptionalConfig): this {
        const meta = getCmdServiceMeta(cls)
        if (!meta) {
            throw new Error(
                `CmdNodeApp.useCommand: ${cls.name ?? '(anon)'} is not decorated with @CmdService`,
            )
        }
        if (this._serviceClasses.has(meta.name)) {
            throw new Error(`CmdNodeApp.useCommand: duplicate command name "${meta.name}"`)
        }
        this._serviceClasses.set(meta.name, cls)
        this._cachedManifest = null
        return this
    }

    useCommands(arr: ServiceClassWithOptionalConfig[]): this {
        for (const cls of arr) this.useCommand(cls)
        return this
    }

    /** Alias for useCommand; kept for symmetry with the hub-side API. */
    useService(cls: ServiceClassWithOptionalConfig): this {
        return this.useCommand(cls)
    }

    /** Snapshot of the registered service classes keyed by command name. */
    get services(): ReadonlyMap<string, ServiceClassWithOptionalConfig> {
        return this._serviceClasses
    }

    /**
     * Build a proto-shaped NodeManifest from the registered service classes.
     * Hardware info is captured fresh on every call; metrics are placeholders
     * — HubClientMiddleware owns the live metrics feed.
     */
    buildManifest(): NodeManifest {
        const commands: ProtoCommand[] = []
        for (const [, cls] of this._serviceClasses) {
            const cmd = buildCommandFromDecorator(cls)
            commands.push({
                name: cmd.name,
                compatibilityId: cmd.compatibilityId,
                version: cmd.version,
                description: cmd.description,
                args: toProtoArgs(cmd.args),
                aliases: cmd.aliases,
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
        }
    }

    /**
     * Build the `IExecutor` the InvokeServer middleware feeds into
     * `makeInvokeServerImpl`. The executor looks up the service class by
     * command name, parses the InvokeStart args into the service's config
     * data-class, and constructs a fresh service instance per invocation.
     */
    protected buildExecutor(): IExecutor {
        const serviceClasses = this._serviceClasses
        const manifestBuilder = () => this.buildManifest()
        return {
            async createService(start: InvokeStart): Promise<RunnableService> {
                const cls = serviceClasses.get(start.commandName)
                if (!cls) {
                    throw new Error(`no service registered for command "${start.commandName}"`)
                }
                const meta = getCmdServiceMeta(cls)!
                const config = CommandArgumentHolder.fromMap(meta.config, start.args)
                const params = CommandArgumentHolder.fromMap(meta.params, start.args)
                const messages = CommandArgumentHolder.fromMap(meta.messages, start.args)
                const input = {
                    config, params, messages,
                    sessionId: start.sessionId,
                    sessionData: {},
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const svc = new (cls as any)(
                    start.userId,
                    { config, params, messages, sessionId: start.sessionId, sessionData: {} },
                    input,
                ) as RunnableService
                return svc
            },
            getManifest(): NodeManifest {
                return manifestBuilder()
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
            if (seen.has(ns)) {
                // Collision detection lives in Application._buildMergedSchema; we just
                // let duplicates through here so the caller sees the richer error.
            }
            seen.add(ns)
            out.push({ namespace: ns, schema })
        }
        return out
    }

    async Initialize(): Promise<void> {
        // Build and stash the manifest + executor so middlewares (installed by
        // super.Initialize()) can read them out.
        this._cachedManifest = this.buildManifest()
        ;(this as unknown as { _nodeManifest: NodeManifest })._nodeManifest = this._cachedManifest
        ;(this as unknown as { _executor: IExecutor })._executor = this.buildExecutor()

        await super.Initialize()
    }

    async run(): Promise<void> {
        // The node is passively driven by incoming gRPC streams; run() just
        // parks the process until terminate() is called.
        await new Promise<void>(() => { /* never resolves */ })
    }

    /** Convenience accessor used by tests. */
    getManifest(): NodeManifest {
        return this._cachedManifest ?? this.buildManifest()
    }
}
