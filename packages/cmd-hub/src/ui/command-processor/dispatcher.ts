import { WithInit } from "@cmd-hub/common";
import { validateWithNeighborsMap } from "@cmd-hub/common";
import { BaseUIContext } from "../../ui/types";

/** Local mirror of the proto ArgSpec the dispatcher's builder consumes. */
export interface RemoteArgSpec {
    name: string
    position: number
    required: boolean
    type: string
    description: string
    enumValues: string[]
    defaultValue: string
}

export interface RemoteCommandSpec {
    name: string
    description: string
    args: ReadonlyArray<RemoteArgSpec>
}

import log from '../../application/logger';

import { CommandSequenceHandler } from "./sequence-handler";
import { BaseCommandService } from "../../ui/types/command/service";

import { Chain } from "@cmd-hub/common";
import {
    IUICommandEntry,
    IHandleResult,
    ICmdRegisterManyEntry,
    ICmdRegisterEntry,
} from "./types";
import { CommandBuilder } from "./builder";
import {
    HandleInvokation,
    HandleCmdBuilder,
    HandleSequenceCommand
} from "./handlers";
import { isContainsAll } from "@cmd-hub/common";
import { anyToString } from "@cmd-hub/common";
import type {
    IManagerRepo,
    IAccountRepo,
    IInvitationLinkRepo,
    ICmdAliasRepo,
    IPendingDeleteRepo,
    CapabilityKey,
} from "@cmd-hub/common";
import { CmdArgumentMetadataRaw, getCmdArgMetadata, isFunc, isService, IUICommandProcessed } from "../../ui/types/command";

export interface DispatcherRepos {
    readonly manager: IManagerRepo
    readonly account: IAccountRepo
    readonly invitationLink: IInvitationLinkRepo
    readonly cmdAlias: ICmdAliasRepo
    readonly pendingDelete: IPendingDeleteRepo
}

import {
    SetVariableCommand,
    GetVariableCommand,
    RemoveVariableCommand,

    ServiceStopCommand,
    ServiceRunCommand,
    ServiceSendMsgCommand,
    ServiceListCommand,

    NextInSeqCommand,
    BackInSeqCommand,
    CancelSeqCommand,

    ConcreetHelp,
    CommonHelp,

    AliasCommand,
    UnaliasCommand,
    ListAliases,

    CalibrateCommand,
    DashboardCommand,
    SConfigCommand,
    ConfigCommand,
    SInfoCommand,
    InviteCommand,
} from "./built-in-cmd";

import 'reflect-metadata'

import { BuiltInCommandNames, toRegister } from "./built-in-cmd";
import { RemoteCmdInvoker } from "./remote-invoker"
import { IUI, UiUnicodeSymbols } from "../../ui";
import { HandleCommandAlias } from "./handlers/alias";
import { ICommandHandlerChain } from "./handlers/abstract-handler";
import { ServiceDashboard } from "./dashboard";

export class CmdDispatcher<UIContextType extends BaseUIContext> extends WithInit {
    private active_services: Map<string, Array<BaseCommandService<any>>>
    private dashboards: Map<string, ServiceDashboard<UIContextType>> = new Map()
    private cmd_registry: Map<string, IUICommandEntry<UIContextType>>

    /** Initialised in done() — see neighbours map validation. */
    private sequenceHandler!: CommandSequenceHandler
    private cmdBuilder: CommandBuilder
    /** Null in bootstrap-only tests that never attach a node. */
    private _remoteInvoker: RemoteCmdInvoker | null = null
    private _manifestAggregator: {
        listManifests(): Array<{
            commands: Array<{
                name: string
                description: string
                args?: ReadonlyArray<RemoteArgSpec>
            }>
        }>
        findCommand?(name: string): {
            name: string
            description: string
            args?: ReadonlyArray<RemoteArgSpec>
        } | undefined
        configModuleOwners(module: string): string[]
    } | null = null
    private _nodeClient: { configReload?(nodeId: string, moduleName: string): Promise<void> } | null = null
    private _repos: DispatcherRepos | null = null
    private chain: ICommandHandlerChain<UIContextType>

    constructor() {
        super()
        this.chain = new Chain()
        this.cmd_registry = new Map()
        this.active_services = new Map()
        this.cmdBuilder = new CommandBuilder()

        this.chain.use(new HandleCommandAlias<UIContextType>)
        this.chain.use(new HandleCmdBuilder<UIContextType>)
        this.chain.use(new HandleSequenceCommand<UIContextType>)
        this.chain.use(new HandleInvokation<UIContextType>)
    }

    attachRemoteInvoker(invoker: RemoteCmdInvoker): void {
        this._remoteInvoker = invoker
    }

    attachManifestAggregator(agg: NonNullable<typeof this._manifestAggregator>): void {
        this._manifestAggregator = agg
    }

    attachNodeClient(client: NonNullable<typeof this._nodeClient>): void {
        this._nodeClient = client
    }

    attachRepos(repos: DispatcherRepos): void {
        this._repos = repos
    }

    /** Throws when no storage middleware has run. */
    requireRepos(callerName: string): DispatcherRepos {
        if (!this._repos) {
            throw new Error(
                `CmdDispatcher.${callerName}: no repos attached — ` +
                `register a storage middleware (e.g. MongoStorageMiddleware) and use CmdHubApp`,
            )
        }
        return this._repos
    }

    /** Prefer `requireRepos()`. The nullable getter is for autocomplete /
     *  pairOptions callbacks that run before boot validation and degrade
     *  silently when repos aren't yet attached. */
    get repos(): DispatcherRepos | null { return this._repos }

    /** Local commands only; remote commands flow through their own (future
     *  Phase C) distributed validation path. Returns the cap keys with their
     *  brand intact so consumers (e.g. `CmdHubApp._validateAttachedDispatchers`)
     *  can pass them straight to `app.has(...)` without flattening to `string`
     *  and recasting via `as never`. */
    collectRegisteredCommands(): { name: string; requires: readonly CapabilityKey<unknown>[] }[] {
        const out: { name: string; requires: readonly CapabilityKey<unknown>[] }[] = []
        for (const [name, entry] of this.cmd_registry) {
            out.push({
                name,
                requires: entry.requires ?? [],
            })
        }
        return out
    }

    /** Fan a ConfigReload to every node that declared the module. Errors
     *  per-node are swallowed; returns null when transport isn't wired. */
    async fanoutConfigReload(moduleName: string): Promise<{ notified: number; failed: number } | null> {
        if (!this._manifestAggregator || !this._nodeClient?.configReload) return null
        const owners = this._manifestAggregator.configModuleOwners(moduleName)
        let notified = 0
        let failed = 0
        for (const nodeId of owners) {
            try {
                await this._nodeClient.configReload(nodeId, moduleName)
                notified++
            } catch {
                failed++
            }
        }
        return { notified, failed }
    }

    public async handleCommand(command: string, userText: string, ctx: UIContextType, uiImpl: IUI<UIContextType>): Promise<IHandleResult> {
        const splited = userText.trim().split(" ")
        // Rewrite `name=value` → `--name value` so the builder grammar stays one shape.
        const args = splited.slice(1).flatMap((tok) => {
            if (tok.startsWith('-')) return [tok]
            const eq = tok.indexOf('=')
            if (eq <= 0) return [tok]
            return [`--${tok.slice(0, eq)}`, tok.slice(eq + 1)]
        })
        const _userId = ctx.manager?.userId

        if (!_userId) {
            return {
                success: false,
                markup: {
                    text: ` ${UiUnicodeSymbols.error} No user id.`,
                }
            }
        }

        command = command.split(" ")[0]
        try {
            return await this.chain.handle({
                dispatcher: this,
                command: command,
                text: [command, ...args].join(' '),
                userId: String(_userId),
                ownerId: String(ctx.manager!.id),
                words: args,
                uiCtx: ctx,
                uiImpl: uiImpl
            })
        } catch(e: unknown) {
            log.error(anyToString(e))
            return {
                success: false,
                markup: {
                    text: `${UiUnicodeSymbols.error} Command handling chain failed:\n ${anyToString(e)}`
                }
            }
        }
    }

    public registerMany(entries: ICmdRegisterManyEntry<UIContextType>) {
        entries.forEach(entry => this.register(entry))
    }

    public register({command, invokable, requires}: ICmdRegisterEntry<UIContextType>) {
        if (this.isInitialized()) {
            throw new Error("Not permitted to register command after init");
        }

        this.validateCmdName(command.command)
        this.registerWrapper({command, invokable, requires})
    }

    /**
    * @description All command registred with this method not allowed to use in sequence
    */
    unBoundRegister({command, invokable, requires}: ICmdRegisterEntry<UIContextType>) {
        this.validateCmdName(command.command)
        this.registerWrapper({command, invokable, requires}, false)
    }

    private validateCmdName(command: string) {
        if (command in this.cmd_registry) {
            throw new Error("CommandHandler.register() command already registered: " + command);
        }
    }

    private registerWrapper({command, invokable, requires}: ICmdRegisterEntry<UIContextType>, bounded = true) {
        let argsDesc: (CmdArgumentMetadataRaw&{name: string})[] = []
        if (command.args) {
            const _args = command.args
            const metaArg = getCmdArgMetadata<any>(_args)
            for (const key in metaArg) {
                const arg = metaArg[key]
                argsDesc.push({
                    ...arg,
                    name: key
                })
            }
        }

        this.cmd_registry.set(
            command.command,
            {
                invokable: invokable,
                description: command.description,
                args: argsDesc,
                next: command.next,
                prev: command.prev,
                seqBounded: bounded,
                requires,
            },
        );
    }

    done() {
        this.registerMany([
            toRegister(SetVariableCommand as any, this),
            toRegister(RemoveVariableCommand as any, this),
            toRegister(GetVariableCommand as any, this),

            toRegister(ServiceStopCommand as any, this),
            toRegister(ServiceRunCommand as any, this),
            toRegister(ServiceSendMsgCommand as any, this),
            toRegister(ServiceListCommand as any, this),

            toRegister(NextInSeqCommand as any, this),
            toRegister(BackInSeqCommand as any, this),
            toRegister(CancelSeqCommand as any, this),

            toRegister(ConcreetHelp as any, this),
            toRegister(CommonHelp as any, this),

            toRegister(AliasCommand as any, this),
            toRegister(UnaliasCommand as any, this),
            toRegister(ListAliases as any, this),

            toRegister(CalibrateCommand as any, this),
            toRegister(DashboardCommand as any, this),
            toRegister(SConfigCommand as any, this),
            toRegister(ConfigCommand as any, this),
            toRegister(SInfoCommand as any, this),
            toRegister(InviteCommand as any, this),
        ])

        const cbNames = Array.from(this.cmd_registry.keys())
        if (!isContainsAll(cbNames, BuiltInCommandNames)) {
            throw new Error("CommandHandler::done() not all built-in commands registered");
        }

        if (!validateWithNeighborsMap(this.cmd_registry)) {
            throw new Error("CommandHandler::done() invalid invokables map");
        }

        const targets: string[] = Array.from(this.cmd_registry.keys())
        const naighbors: IUICommandEntry<UIContextType>[] = Array.from(this.cmd_registry.values())
        this.sequenceHandler = new CommandSequenceHandler(
            Array.from(
                targets.map((v, i) =>
                    ({
                        target: v,
                        next: naighbors[i].next,
                        prev: naighbors[i].prev
                    })
                )
            )
        )

        log.info(`CmdDispatcher: registered ${targets.length} command(s)`)
        this.setInitialized()
    }

    async stopAllServices() {
        for (const [userId, services] of this.active_services) {
            log.info(" -- Stoping services for user: " + userId)
            const terminatePromises = []
            for (const s of services) {
                log.info("  -- terminating service: " + s.name)
                await s.terminate()
                terminatePromises.push(
                    new Promise(resolve => s.on("done", resolve))
                )
            }
            await Promise.all(terminatePromises)
            log.info("  -- All services for user: " + userId + " stopped")
        }
        log.info(" -- All services stopped")
    }

    async terminateService(userId: string, serviceName: string) {
        if (!this.isServiceActive(userId, serviceName)) {
            throw new Error(`Service "${serviceName}" of user ${userId} not active`)
        }

        const services = this.UserActiveServices(userId)
        try {
            await services.find(serv => serv.name === serviceName)!.terminate()
        } catch (e) {
            log.error(`Cannot terminate service "${serviceName}" for user "${userId}": ${anyToString(e)}`)
            throw new Error(`Service "${serviceName}" terminate error: ${anyToString(e)}`)
        }
    }

    public isService(name: string): boolean {
        const cb = this.tryGetInvokable(name)
        if (!cb) {
            // Remote commands aren't in the local registry; treat as not-a-service.
            log.debug(`isService("${name}"): not in local registry`)
            return false
        }
        return isService(cb.invokable)
    }

    isAllArgsPassed(command: string, passedArgs: string[]): boolean {
        const cmd = this.cmd_registry.get(command)
        if (cmd) {
            if (isFunc(cmd.invokable)) {
                if (!cmd.args || cmd.args.length === 0) {
                    return true
                }
                const requiredArgs = cmd.args.filter(a => a.required)
                return passedArgs.length >= requiredArgs.length
            }
            // Services always open the builder, even with all args typed.
            return false
        }

        const remote = this.tryGetRemoteCommand(command)
        if (remote) {
            const requiredCount = remote.args.filter(a => a.required).length
            return passedArgs.length >= requiredCount
        }

        log.error(`While processing command "${command}" with passed arguments "${passedArgs.join(", ")}", command not found`)
        return true
    }

    isBuiltInCommand(command: string) {
        return BuiltInCommandNames.includes(command)
    }

    isCommandRegistered(command: string) {
        return this.cmd_registry.has(command)
    }

    get CommandInvoker(): RemoteCmdInvoker | null {
        return this._remoteInvoker
    }

    get RemoteInvoker(): RemoteCmdInvoker | null {
        return this._remoteInvoker
    }

    get SequenceHandler() {
        return this.sequenceHandler!
    }

    get CommandBuilder() {
        return this.cmdBuilder
    }

    get ActiveServices() {
        return this.active_services
    }

    UserActiveServices(userId: string): Array<BaseCommandService<any>> {
        const s = this.active_services.get(userId)
        if (!s) {
            this.active_services.set(userId, [])
        }
        return this.active_services.get(userId)!
    }

    RemoveUserActiveService(userId: string, serviceName: string) {
        const s = this.UserActiveServices(userId)
        const instance = s.find(serv => serv.name === serviceName)
        if (!instance) {
            throw new Error(`No active service "${serviceName}" for user "${userId}" `)
        }
        s.splice(s.indexOf(instance), 1)
        // Detach dashboard (keeps message as final snapshot, doesn't remove reference)
        const dash = this.getDashboard(userId, serviceName)
        if (dash) {
            dash.detach().catch(() => {})
        }
    }

    /** Destroy dashboard and remove reference (for explicit close / wipe) */
    async destroyDashboard(userId: string, serviceName: string) {
        const dash = this.getDashboard(userId, serviceName)
        if (dash) {
            await dash.destroy()
            this.removeDashboard(userId, serviceName)
        }
    }

    /** Destroy all dashboards for a user */
    async destroyAllDashboards(userId: string) {
        const keys = Array.from(this.dashboards.keys()).filter(k => k.startsWith(userId + ':'))
        for (const key of keys) {
            const dash = this.dashboards.get(key)
            if (dash) {
                await dash.destroy()
            }
            this.dashboards.delete(key)
        }
    }

    // Dashboard management

    private dashboardKey(userId: string, serviceName: string) {
        return `${userId}:${serviceName}`
    }

    setDashboard(userId: string, serviceName: string, dashboard: ServiceDashboard<UIContextType>) {
        this.dashboards.set(this.dashboardKey(userId, serviceName), dashboard)
    }

    getDashboard(userId: string, serviceName: string): ServiceDashboard<UIContextType> | undefined {
        return this.dashboards.get(this.dashboardKey(userId, serviceName))
    }

    removeDashboard(userId: string, serviceName: string) {
        this.dashboards.delete(this.dashboardKey(userId, serviceName))
    }

    async UserServiceSessions(userId: string, serviceName: string): Promise<string[]> {
        const cmd = this.getInvokable(serviceName)
        if (isFunc(cmd.invokable)) {
            return []
        }
        const repos = this._repos
        if (!repos) return []

        const owner = await repos.manager.findByUserId(userId)
        if (!owner) return []
        const account = await repos.account.handleByOwnerId(owner.id)
        if (!account) return []
        const moduleHandle = await account.getModuleByName(serviceName)
        if (!moduleHandle) return []
        const sessions = await moduleHandle.getSessions()
        return sessions.map(s => s.record.name)
    }

    isServiceActive(userId: string, serviceName: string) {
        const services = this.active_services.get(userId)
        if (!services) {
            return false
        }
        return services.map(s => s.name).includes(serviceName)
    }

    getInvokable(command: string): IUICommandEntry<UIContextType> {
        const cb = this.cmd_registry.get(command)
        if (!cb) {
            throw new Error(`Command ${UiUnicodeSymbols.arrowRight} "${command}" not found.`)
        }
        return cb!
    }

    /** Non-throwing variant of `getInvokable`. */
    tryGetInvokable(command: string): IUICommandEntry<UIContextType> | undefined {
        return this.cmd_registry.get(command)
    }

    /** Pool-backed name index when available; falls back to linear walk
     *  for older test fixtures that mock the aggregator without `findCommand`. */
    tryGetRemoteCommand(command: string): RemoteCommandSpec | undefined {
        const agg = this._manifestAggregator
        if (!agg) return undefined
        if (agg.findCommand) {
            const c = agg.findCommand(command)
            if (!c) return undefined
            return { name: c.name, description: c.description, args: c.args ?? [] }
        }
        for (const m of agg.listManifests()) {
            for (const c of m.commands) {
                if (c.name === command) {
                    return { name: c.name, description: c.description, args: c.args ?? [] }
                }
            }
        }
        return undefined
    }

    public getRegistredServiceNames(): string[] {
        let ret: string[] = []
        this.cmd_registry.forEach((v) => {
            if (isService(v.invokable)) {
                ret.push(v.invokable.name)
            }
        })
        return ret
    }

    public getRegistredCommandNames(): string[] {
        let ret: string[] = []
        for (const [key, value] of this.cmd_registry) {
            if (isFunc(value.invokable)) {
                ret.push(key)
            }
        }
        return ret
    }

    public toUICommands(): IUICommandProcessed[] {
        let commands = Array.from(this.cmd_registry.keys())
        const cmd_descriptions = Array.from(this.cmd_registry.values()).map(v => v.description)
        const cmd_args = Array.from(this.cmd_registry.values()).map(v => v.args)

        const registredCmds: IUICommandProcessed[] = new Array(commands.length).fill(0).map(
            (_, i) => ({
                command: commands[i],
                description: cmd_descriptions[i],
                args: cmd_args[i]
            })
        )

        // Local built-ins (e.g. `/help`) win on name collision with remote nodes.
        if (this._manifestAggregator) {
            const localNames = new Set(commands)
            for (const m of this._manifestAggregator.listManifests()) {
                for (const c of m.commands) {
                    if (localNames.has(c.name)) continue
                    registredCmds.push({
                        command: c.name,
                        description: c.description,
                        args: [],
                    })
                    localNames.add(c.name)
                }
            }
        }

        return registredCmds
    }

}
