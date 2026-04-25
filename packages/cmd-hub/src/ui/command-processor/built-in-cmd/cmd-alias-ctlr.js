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
Object.defineProperty(exports, "__esModule", { value: true });
exports.ListAliases = exports.UnaliasCommand = exports.AliasCommand = exports.MAX_ALIAS_NAME_LEN = void 0;
const command_1 = require("../../../ui/types/command");
const constants_1 = require("../constants");
const ui_1 = require("../../../ui");
const common_1 = require("@cmd-hub/common");
exports.MAX_ALIAS_NAME_LEN = 32;
function isValidAliasName(alias) {
    return /^[a-zA-Z0-9_]+$/.test(alias);
}
class AliasArgs {
    alias;
    command;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 1,
        description: "Alias name",
    }),
    __metadata("design:type", String)
], AliasArgs.prototype, "alias", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 2,
        description: "Command to alias",
    }),
    __metadata("design:type", String)
], AliasArgs.prototype, "command", void 0);
const AliasCommand = {
    command: constants_1.BuiltInAliasCommandsEnum.ALIAS_COMMAND,
    description: "Print help for concreet command",
    args: AliasArgs,
    requires: [common_1.CAP_CmdAliasRepo],
    invokable: async function (args, ctx) {
        const aliasName = args.getOrThrow('alias');
        const commandStr = args.getOrThrow('command');
        const ownerId = ctx.manager.id;
        const repo = this.requireRepos('alias').cmdAlias;
        if (!isValidAliasName(aliasName)) {
            throw new Error(`Alias name "${aliasName}" is not valid. It must be alphanumeric, numeric and underscore only`);
        }
        if (aliasName.length > exports.MAX_ALIAS_NAME_LEN) {
            throw new Error(`Alias name "${aliasName}" is too long. Max length is ${exports.MAX_ALIAS_NAME_LEN}`);
        }
        const existing = await repo.findByOwnerAndAlias(ownerId, aliasName);
        if (existing) {
            throw new Error(`Alias "${aliasName}" already exists`);
        }
        await repo.create({ alias: aliasName, command: commandStr, ownerId });
    }
};
exports.AliasCommand = AliasCommand;
class UnAliasArgs {
    alias;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 1,
        description: "Alias name to remove",
    }),
    __metadata("design:type", String)
], UnAliasArgs.prototype, "alias", void 0);
const UnaliasCommand = {
    command: constants_1.BuiltInAliasCommandsEnum.UNALIAS_COMMAND,
    description: "Unalias command",
    args: UnAliasArgs,
    requires: [common_1.CAP_CmdAliasRepo],
    invokable: async function (args, ctx) {
        const aliasName = args.getOrThrow('alias');
        const ownerId = ctx.manager.id;
        const repo = this.requireRepos('unalias').cmdAlias;
        const deletedCount = await repo.deleteByOwnerAndAlias(ownerId, aliasName);
        if (deletedCount === 0) {
            throw new Error(`Alias "${aliasName}" not found`);
        }
        await ctx.reply(`Alias "${aliasName}" removed`);
    }
};
exports.UnaliasCommand = UnaliasCommand;
const ListAliases = {
    command: constants_1.BuiltInAliasCommandsEnum.LIST_ALIASES_COMMAND,
    description: "Show all user aliases",
    args: [],
    requires: [common_1.CAP_CmdAliasRepo],
    invokable: async function (_, ctx) {
        const ownerId = ctx.manager.id;
        const repo = this.requireRepos('listAliases').cmdAlias;
        const aliases = await repo.listByOwner(ownerId);
        const aliasesStr = `Aliases for user "${ownerId}":\n` +
            aliases.map(a => ` -- <${a.alias}>: ${ui_1.UiUnicodeSymbols.gear} "${a.command}"`).join("\n");
        await ctx.reply(aliasesStr);
    }
};
exports.ListAliases = ListAliases;
