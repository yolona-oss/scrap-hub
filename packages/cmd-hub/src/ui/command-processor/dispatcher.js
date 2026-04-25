"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CmdDispatcher = void 0;
const with_init_1 = require("../../types/with-init");
const with_neighbors_1 = require("../../types/with-neighbors");
const logger_1 = __importDefault(require("../../application/logger"));
const sequence_handler_1 = require("./sequence-handler");
const chain_1 = require("../../utils/chain");
const builder_1 = require("./builder");
const handlers_1 = require("./handlers");
const array_1 = require("../../utils/array");
const misc_1 = require("../../utils/misc");
const command_1 = require("../../ui/types/command");
const built_in_cmd_1 = require("./built-in-cmd");
require("reflect-metadata");
const built_in_cmd_2 = require("./built-in-cmd");
const ui_1 = require("../../ui");
const alias_1 = require("./handlers/alias");
class CmdDispatcher extends with_init_1.WithInit {
    active_services;
    dashboards = new Map();
    cmd_registry;
    sequenceHandler;
    cmdBuilder;
    _remoteInvoker = null;
    _manifestAggregator = null;
    _nodeClient = null;
    _repos = null;
    chain;
    constructor() {
        super();
        this.chain = new chain_1.Chain();
        this.cmd_registry = new Map();
        this.active_services = new Map();
        this.cmdBuilder = new builder_1.CommandBuilder();
        this.chain.use(new alias_1.HandleCommandAlias);
        this.chain.use(new handlers_1.HandleCmdBuilder);
        this.chain.use(new handlers_1.HandleSequenceCommand);
        this.chain.use(new handlers_1.HandleInvokation);
    }
    attachRemoteInvoker(invoker) {
        this._remoteInvoker = invoker;
    }
    attachManifestAggregator(agg) {
        this._manifestAggregator = agg;
    }
    attachNodeClient(client) {
        this._nodeClient = client;
    }
    attachRepos(repos) {
        this._repos = repos;
    }
    requireRepos(callerName) {
        if (!this._repos) {
            throw new Error(`CmdDispatcher.${callerName}: no repos attached — ` +
                `register a storage middleware (e.g. MongoStorageMiddleware) and use CmdHubApp`);
        }
        return this._repos;
    }
    get repos() { return this._repos; }
    collectRegisteredCommands() {
        const out = [];
        for (const [name, entry] of this.cmd_registry) {
            out.push({
                name,
                requires: (entry.requires ?? []).map(k => k),
            });
        }
        return out;
    }
    async fanoutConfigReload(moduleName) {
        if (!this._manifestAggregator || !this._nodeClient?.configReload)
            return null;
        const owners = this._manifestAggregator.configModuleOwners(moduleName);
        let notified = 0;
        let failed = 0;
        for (const nodeId of owners) {
            try {
                await this._nodeClient.configReload(nodeId, moduleName);
                notified++;
            }
            catch {
                failed++;
            }
        }
        return { notified, failed };
    }
    async handleCommand(command, userText, ctx, uiImpl) {
        const splited = userText.trim().split(" ");
        const args = splited.slice(1);
        const _userId = ctx.manager?.userId;
        if (!_userId) {
            return {
                success: false,
                markup: {
                    text: ` ${ui_1.UiUnicodeSymbols.error} No user id.`,
                }
            };
        }
        command = command.split(" ")[0];
        try {
            return await this.chain.handle({
                dispatcher: this,
                command: command,
                text: userText,
                userId: String(_userId),
                ownerId: String(ctx.manager.id),
                words: args,
                uiCtx: ctx,
                uiImpl: uiImpl
            });
        }
        catch (e) {
            logger_1.default.error((0, misc_1.anyToString)(e));
            return {
                success: false,
                markup: {
                    text: `${ui_1.UiUnicodeSymbols.error} Command handling chain failed:\n ${(0, misc_1.anyToString)(e)}`
                }
            };
        }
    }
    registerMany(entries) {
        entries.forEach(entry => this.register(entry));
    }
    register({ command, invokable, requires }) {
        if (this.isInitialized()) {
            throw new Error("Not permitted to register command after init");
        }
        this.validateCmdName(command.command);
        this.registerWrapper({ command, invokable, requires });
    }
    unBoundRegister({ command, invokable, requires }) {
        this.validateCmdName(command.command);
        this.registerWrapper({ command, invokable, requires }, false);
    }
    validateCmdName(command) {
        if (command in this.cmd_registry) {
            throw new Error("CommandHandler.register() command already registered: " + command);
        }
    }
    registerWrapper({ command, invokable, requires }, bounded = true) {
        let argsDesc = [];
        if (command.args) {
            const _args = command.args;
            const metaArg = (0, command_1.getCmdArgMetadata)(_args);
            for (const key in metaArg) {
                const arg = metaArg[key];
                argsDesc.push({
                    ...arg,
                    name: key
                });
            }
        }
        this.cmd_registry.set(command.command, {
            invokable: invokable,
            description: command.description,
            args: argsDesc,
            next: command.next,
            prev: command.prev,
            seqBounded: bounded,
            requires,
        });
    }
    done() {
        this.registerMany([
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.SetVariableCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.RemoveVariableCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.GetVariableCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.ServiceStopCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.ServiceRunCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.ServiceSendMsgCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.ServiceListCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.NextInSeqCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.BackInSeqCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.CancelSeqCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.ConcreetHelp, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.CommonHelp, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.AliasCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.UnaliasCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.ListAliases, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.CalibrateCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.DashboardCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.SConfigCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.ConfigCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.SInfoCommand, this),
            (0, built_in_cmd_2.toRegister)(built_in_cmd_1.InviteCommand, this),
        ]);
        const cbNames = Array.from(this.cmd_registry.keys());
        if (!(0, array_1.isContainsAll)(cbNames, built_in_cmd_2.BuiltInCommandNames)) {
            throw new Error("CommandHandler::done() not all built-in commands registered");
        }
        if (!(0, with_neighbors_1.validateWithNeighborsMap)(this.cmd_registry)) {
            throw new Error("CommandHandler::done() invalid invokables map");
        }
        const targets = Array.from(this.cmd_registry.keys());
        const naighbors = Array.from(this.cmd_registry.values());
        this.sequenceHandler = new sequence_handler_1.CommandSequenceHandler(Array.from(targets.map((v, i) => ({
            target: v,
            next: naighbors[i].next,
            prev: naighbors[i].prev
        }))));
        this.setInitialized();
    }
    async stopAllServices() {
        for (const [userId, services] of this.active_services) {
            logger_1.default.info(" -- Stoping services for user: " + userId);
            const terminatePromises = [];
            for (const s of services) {
                logger_1.default.info("  -- terminating service: " + s.name);
                await s.terminate();
                terminatePromises.push(new Promise(resolve => s.on("done", resolve)));
            }
            await Promise.all(terminatePromises);
            logger_1.default.info("  -- All services for user: " + userId + " stopped");
        }
        logger_1.default.info(" -- All services stopped");
    }
    async terminateService(userId, serviceName) {
        if (!this.isServiceActive(userId, serviceName)) {
            throw new Error(`Service "${serviceName}" of user ${userId} not active`);
        }
        const services = this.UserActiveServices(userId);
        try {
            await services.find(serv => serv.name === serviceName).terminate();
        }
        catch (e) {
            logger_1.default.error(`Cannot terminate service "${serviceName}" for user "${userId}": ${(0, misc_1.anyToString)(e)}`);
            throw new Error(`Service "${serviceName}" terminate error: ${(0, misc_1.anyToString)(e)}`);
        }
    }
    isService(name) {
        const cb = this.getInvokable(name);
        if (!cb) {
            logger_1.default.debug(`Trying check invokable type for command "${name}" but command not found.`);
            return false;
        }
        return (0, command_1.isService)(cb.invokable);
    }
    isAllArgsPassed(command, passedArgs) {
        const cmd = this.cmd_registry.get(command);
        if (!cmd) {
            logger_1.default.error(`While processing command "${command}" with passed arguments "${passedArgs.join(", ")}", command not found`);
            return true;
        }
        if ((0, command_1.isFunc)(cmd.invokable)) {
            if (!cmd.args || cmd.args.length === 0) {
                return true;
            }
            const requiredArgs = cmd.args.filter(a => a.required);
            return passedArgs.length >= requiredArgs.length;
        }
        else {
            return false;
        }
    }
    isBuiltInCommand(command) {
        return built_in_cmd_2.BuiltInCommandNames.includes(command);
    }
    isCommandRegistered(command) {
        return this.cmd_registry.has(command);
    }
    get CommandInvoker() {
        return this._remoteInvoker;
    }
    get RemoteInvoker() {
        return this._remoteInvoker;
    }
    get SequenceHandler() {
        return this.sequenceHandler;
    }
    get CommandBuilder() {
        return this.cmdBuilder;
    }
    get ActiveServices() {
        return this.active_services;
    }
    UserActiveServices(userId) {
        const s = this.active_services.get(userId);
        if (!s) {
            this.active_services.set(userId, []);
        }
        return this.active_services.get(userId);
    }
    RemoveUserActiveService(userId, serviceName) {
        const s = this.UserActiveServices(userId);
        const instance = s.find(serv => serv.name === serviceName);
        if (!instance) {
            throw new Error(`No active service "${serviceName}" for user "${userId}" `);
        }
        s.splice(s.indexOf(instance), 1);
        const dash = this.getDashboard(userId, serviceName);
        if (dash) {
            dash.detach().catch(() => { });
        }
    }
    async destroyDashboard(userId, serviceName) {
        const dash = this.getDashboard(userId, serviceName);
        if (dash) {
            await dash.destroy();
            this.removeDashboard(userId, serviceName);
        }
    }
    async destroyAllDashboards(userId) {
        const keys = Array.from(this.dashboards.keys()).filter(k => k.startsWith(userId + ':'));
        for (const key of keys) {
            const dash = this.dashboards.get(key);
            if (dash) {
                await dash.destroy();
            }
            this.dashboards.delete(key);
        }
    }
    dashboardKey(userId, serviceName) {
        return `${userId}:${serviceName}`;
    }
    setDashboard(userId, serviceName, dashboard) {
        this.dashboards.set(this.dashboardKey(userId, serviceName), dashboard);
    }
    getDashboard(userId, serviceName) {
        return this.dashboards.get(this.dashboardKey(userId, serviceName));
    }
    removeDashboard(userId, serviceName) {
        this.dashboards.delete(this.dashboardKey(userId, serviceName));
    }
    async UserServiceSessions(userId, serviceName) {
        const cmd = this.getInvokable(serviceName);
        if ((0, command_1.isFunc)(cmd.invokable)) {
            return [];
        }
        const repos = this._repos;
        if (!repos)
            return [];
        const owner = await repos.manager.findByUserId(userId);
        if (!owner)
            return [];
        const account = await repos.account.handleByOwnerId(owner.id);
        if (!account)
            return [];
        const moduleHandle = await account.getModuleByName(serviceName);
        if (!moduleHandle)
            return [];
        const sessions = await moduleHandle.getSessions();
        return sessions.map(s => s.record.name);
    }
    isServiceActive(userId, serviceName) {
        const services = this.active_services.get(userId);
        if (!services) {
            return false;
        }
        return services.map(s => s.name).includes(serviceName);
    }
    getInvokable(command) {
        const cb = this.cmd_registry.get(command);
        if (!cb) {
            throw new Error(`Command ${ui_1.UiUnicodeSymbols.arrowRight} "${command}" not found.`);
        }
        return cb;
    }
    getRegistredServiceNames() {
        let ret = [];
        this.cmd_registry.forEach((v) => {
            if ((0, command_1.isService)(v.invokable)) {
                ret.push(v.invokable.name);
            }
        });
        return ret;
    }
    getRegistredCommandNames() {
        let ret = [];
        for (const [key, value] of this.cmd_registry) {
            if ((0, command_1.isFunc)(value.invokable)) {
                ret.push(key);
            }
        }
        return ret;
    }
    toUICommands() {
        let commands = Array.from(this.cmd_registry.keys());
        const cmd_descriptions = Array.from(this.cmd_registry.values()).map(v => v.description);
        const cmd_args = Array.from(this.cmd_registry.values()).map(v => v.args);
        const registredCmds = new Array(commands.length).fill(0).map((_, i) => ({
            command: commands[i],
            description: cmd_descriptions[i],
            args: cmd_args[i]
        }));
        if (this._manifestAggregator) {
            const localNames = new Set(commands);
            for (const m of this._manifestAggregator.listManifests()) {
                for (const c of m.commands) {
                    if (localNames.has(c.name))
                        continue;
                    registredCmds.push({
                        command: c.name,
                        description: c.description,
                        args: [],
                    });
                    localNames.add(c.name);
                }
            }
        }
        return registredCmds;
    }
}
exports.CmdDispatcher = CmdDispatcher;
