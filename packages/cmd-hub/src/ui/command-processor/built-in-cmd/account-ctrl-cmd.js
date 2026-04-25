"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.GetVariableCommand = exports.RemoveVariableCommand = exports.SetVariableCommand = void 0;
const command_1 = require("../../../ui/types/command");
const constants_1 = require("../constants");
const logger_1 = __importDefault(require("../../../application/logger"));
require("reflect-metadata");
const object_1 = require("../../../utils/object");
const ui_1 = require("../../../ui");
const validation_1 = require("../../../utils/validation");
const common_1 = require("@cmd-hub/common");
async function listModuleNames(repo, accountId) {
    const account = await repo.handleById(accountId);
    if (!account) {
        logger_1.default.error(`account-ctrl: account ${accountId} not found`);
        return [];
    }
    const modules = await account.getModules();
    return modules.map(m => m.record.name);
}
async function listModuleNamesViaDispatcher(dispatcher, accountId) {
    if (!accountId)
        return [];
    const repos = dispatcher.repos;
    if (!repos)
        return [];
    return listModuleNames(repos.account, accountId);
}
class SetVariableArgs {
    module;
    path;
    value;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 1,
        description: "Module name",
        pairOptions: async (_, handler) => {
            return handler.getRegistredServiceNames();
        }
    }),
    __metadata("design:type", String)
], SetVariableArgs.prototype, "module", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        description: "Variable path",
        position: 2,
        pairOptions: []
    }),
    __metadata("design:type", String)
], SetVariableArgs.prototype, "path", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 3,
        description: "Variable value",
        pairOptions: []
    }),
    __metadata("design:type", String)
], SetVariableArgs.prototype, "value", void 0);
const SetVariableCommand = {
    command: constants_1.BuiltInAccountCommandsEnum.SET_VARIABLE,
    description: "Create or update variable for user execution context",
    args: SetVariableArgs,
    requires: [common_1.CAP_ManagerRepo, common_1.CAP_AccountRepo],
    invokable: async function (args, ctx) {
        const repos = this.requireRepos('setVariable');
        const userId = String(ctx.manager.userId);
        const owner = await repos.manager.findByUserId(userId);
        if (!owner?.accountId) {
            throw new Error(`Account not found. User: ${userId}`);
        }
        const account = await repos.account.handleById(owner.accountId);
        if (!account) {
            throw new Error(`Account ${owner.accountId} not found. User: ${userId}`);
        }
        const moduleName = args.getOrThrow('module');
        const path = args.getOrThrow('path');
        const value = args.getOrThrow('value');
        if (!(0, validation_1.isValidConfigPath)(path)) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Invalid path: "${path}"`);
            return;
        }
        const { module } = await account.getModuleByNameOrCreate(moduleName);
        await module.setDataPath(path, value);
        await ctx.reply(`Variable "${path}" set to "${value}" on module "${moduleName}"`);
    }
};
exports.SetVariableCommand = SetVariableCommand;
class RemoveVariableArgs {
    module;
    path;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        description: "Module name",
        position: 1,
        pairOptions: async (_, dispatcher, owner) => {
            return listModuleNamesViaDispatcher(dispatcher, owner.accountId);
        }
    }),
    __metadata("design:type", String)
], RemoveVariableArgs.prototype, "module", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        description: "Variable path",
        position: 2,
        pairOptions: []
    }),
    __metadata("design:type", String)
], RemoveVariableArgs.prototype, "path", void 0);
const RemoveVariableCommand = {
    command: constants_1.BuiltInAccountCommandsEnum.REMOVE_VARIABLE,
    description: "Remove variable for user execution context",
    args: RemoveVariableArgs,
    requires: [common_1.CAP_ManagerRepo, common_1.CAP_AccountRepo],
    invokable: async function (args, ctx) {
        const repos = this.requireRepos('removeVariable');
        const userId = String(ctx.manager.userId);
        const owner = await repos.manager.findByUserId(userId);
        if (!owner?.accountId) {
            throw new Error(`${ui_1.UiUnicodeSymbols.error} Account not found.\nUser: ${ui_1.UiUnicodeSymbols.user} "${userId}"`);
        }
        const account = await repos.account.handleById(owner.accountId);
        if (!account) {
            throw new Error(`${ui_1.UiUnicodeSymbols.error} Account "${owner.accountId}" ${ui_1.UiUnicodeSymbols.magnifierGlass} not found.\nUser: ${ui_1.UiUnicodeSymbols.user} "${userId}"`);
        }
        const moduleName = args.getOrThrow('module');
        const path = args.getOrThrow('path');
        const module = await account.getModuleByName(moduleName);
        if (!module) {
            throw new Error(`${ui_1.UiUnicodeSymbols.error} Module "${moduleName}" ${ui_1.UiUnicodeSymbols.magnifierGlass} not found.`);
        }
        await module.setDataPath(path, undefined);
        await ctx.reply(`Field ${ui_1.UiUnicodeSymbols.arrowRight} "${path}" removed`);
    }
};
exports.RemoveVariableCommand = RemoveVariableCommand;
class GetVariableArgs {
    module;
    path;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 1,
        description: "Module name",
        pairOptions: async (_, dispatcher, owner) => {
            return listModuleNamesViaDispatcher(dispatcher, owner.accountId);
        }
    }),
    __metadata("design:type", String)
], GetVariableArgs.prototype, "module", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 2,
        description: "Variable path",
        pairOptions: []
    }),
    __metadata("design:type", String)
], GetVariableArgs.prototype, "path", void 0);
const GetVariableCommand = {
    command: constants_1.BuiltInAccountCommandsEnum.GET_VARIABLE,
    description: "Get variable for user execution context",
    args: GetVariableArgs,
    requires: [common_1.CAP_ManagerRepo, common_1.CAP_AccountRepo],
    invokable: async function (args, ctx) {
        const repos = this.requireRepos('getVariable');
        const userId = String(ctx.manager.userId);
        const owner = await repos.manager.findByUserId(userId);
        if (!owner?.accountId) {
            throw new Error(`Account not found. User: ${userId}`);
        }
        const account = await repos.account.handleById(owner.accountId);
        if (!account) {
            throw new Error(`Account ${owner.accountId} not found. User: ${userId}`);
        }
        const moduleName = args.getOrThrow('module');
        const path = args.getOrThrow('path');
        const module = await account.getModuleByName(moduleName);
        if (!module) {
            throw new Error(`Module ${ui_1.UiUnicodeSymbols.arrowRight} "${moduleName}" not found`);
        }
        const value = (0, object_1.extractValueFromObject)(module.record.data, path);
        await ctx.reply(`${ui_1.UiUnicodeSymbols.magnifierGlass} Data found: "${path}" = "${value}"`);
    }
};
exports.GetVariableCommand = GetVariableCommand;
