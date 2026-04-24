import type {
    NodeManifest,
    Command as ProtoCommand,
    Service as ProtoService,
    ConfigModule as ProtoConfigModule,
    IntercomAction as ProtoIntercomAction,
    ServiceCapabilities as ProtoServiceCapabilities,
    ArgSpec as ProtoArgSpec,
    FieldSpec as ProtoFieldSpec,
} from '@core/grpc/generated/cmd_node'
import { hardwareInfo } from '../manifest/hardware-info'

export interface CommandDefinition {
    name: string
    compatibilityId: string
    version: string
    description: string
    args: ProtoArgSpec[]
    aliases: string[]
    /** Optional hand-rolled runner. Services use serviceClass instead. */
    run?: (ctx: unknown) => Promise<void>
}

export interface ServiceDefinition {
    command: CommandDefinition
    intercomActions: ProtoIntercomAction[]
    caps: ProtoServiceCapabilities
    /** Constructor of a subclass of BaseCommandService. */
    serviceClass: unknown
}

export interface ConfigModuleDefinition {
    name: string
    scope: 'system' | 'user' | 'bootstrap'
    fields: ProtoFieldSpec[]
}

export interface CmdNodeAppOptions {
    nodeId: string
    nodeName: string
    /** Node runtime version — usually read from the host package.json. */
    version: string
    hubAddress?: string
    mongoUrl?: string
}

/**
 * Node-side orchestrator. Register commands and services imperatively, then
 * call .start() to connect to the hub. v1 enforces mandatory compatibility_id
 * and version on every command at registration time — invalid definitions
 * throw immediately so the operator sees the problem at boot.
 */
export class CmdNodeApp {
    private readonly commands: CommandDefinition[] = []
    private readonly services: ServiceDefinition[] = []
    private readonly configModules: ConfigModuleDefinition[] = []
    private started = false

    constructor(readonly opts: CmdNodeAppOptions) {
        if (!opts.nodeId) throw new Error('CmdNodeApp: nodeId is required')
        if (!opts.nodeName) throw new Error('CmdNodeApp: nodeName is required')
        if (!opts.version) throw new Error('CmdNodeApp: version is required')
    }

    useCommand(def: CommandDefinition): this {
        this.validateCommand(def)
        this.commands.push(def)
        return this
    }

    useService(def: ServiceDefinition): this {
        this.validateCommand(def.command)
        this.services.push(def)
        return this
    }

    useConfigModule(def: ConfigModuleDefinition): this {
        if (!def.name) throw new Error('useConfigModule: name is required')
        if (!def.scope) throw new Error('useConfigModule: scope is required')
        this.configModules.push(def)
        return this
    }

    /** Build the NodeManifest protobuf. Stable for a given set of registrations. */
    buildManifest(): NodeManifest {
        const hw = hardwareInfo()
        const toProtoCommand = (c: CommandDefinition): ProtoCommand => ({
            name: c.name,
            compatibilityId: c.compatibilityId,
            version: c.version,
            description: c.description,
            args: c.args,
            aliases: c.aliases,
        })

        const commandsProto: ProtoCommand[] = this.commands.map(toProtoCommand)
        const servicesProto: ProtoService[] = this.services.map((s) => ({
            command: toProtoCommand(s.command),
            intercomActions: s.intercomActions,
            caps: s.caps,
        }))
        const configsProto: ProtoConfigModule[] = this.configModules.map((m) => ({
            name: m.name,
            scope: m.scope,
            fields: m.fields,
        }))

        return {
            nodeId: this.opts.nodeId,
            nodeName: this.opts.nodeName,
            version: this.opts.version,
            commands: commandsProto,
            services: servicesProto,
            configs: configsProto,
            hardware: hw,
            metrics: { gauges: [], counters: [], histograms: [] },
        }
    }

    /** Snapshot of registered definitions — used by the invoke server to look up commands. */
    listCommands(): readonly CommandDefinition[] {
        return this.commands
    }
    listServices(): readonly ServiceDefinition[] {
        return this.services
    }
    listConfigModules(): readonly ConfigModuleDefinition[] {
        return this.configModules
    }

    /** Phase-2 concern: wires the hub gRPC client, calls Register, starts heartbeat. */
    async start(): Promise<void> {
        if (this.started) return
        // gRPC client wiring lands in Phase 2. For now, calling start() is a no-op
        // that just flips the flag so downstream code can assert ordering.
        this.started = true
    }

    async stop(): Promise<void> {
        if (!this.started) return
        this.started = false
    }

    isStarted(): boolean {
        return this.started
    }

    private validateCommand(c: CommandDefinition): void {
        if (!c.name) throw new Error('command.name is required')
        if (!c.compatibilityId) throw new Error(`command "${c.name}": compatibility_id is required`)
        if (!c.version) throw new Error(`command "${c.name}": version is required`)
        if (!/^\d+\.\d+\.\d+/.test(c.version)) {
            throw new Error(`command "${c.name}": version must be semver-shaped, got "${c.version}"`)
        }
    }
}
