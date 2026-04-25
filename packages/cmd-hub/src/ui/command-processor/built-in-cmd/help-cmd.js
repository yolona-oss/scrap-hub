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
exports.ConcreetHelp = exports.CommonHelp = exports.uiCommandsToString = exports.commonToString = exports.serviceToString = void 0;
const command_1 = require("../../../ui/types/command");
const constants_1 = require("../constants");
const misc_1 = require("../../../utils/misc");
const ui_1 = require("../../../ui");
const table_designer_1 = require("../../../utils/table-designer");
const designer = new table_designer_1.TableDesigner();
const DEFAULT_WIDTH = 72;
function metadataToRows(meta) {
    return Object.entries(meta).map(([name, desc]) => [
        name,
        desc.required ? 'yes' : 'no',
        desc.description ?? '',
    ]);
}
const serviceToString = (cmdName, cmdCb, maxWidth) => {
    const w = maxWidth ?? DEFAULT_WIDTH;
    const executor = cmdCb.invokable;
    let text = `Service /${cmdName}\n  ${cmdCb.description}\n\n`;
    const configRows = metadataToRows(executor.configDescriptor());
    if (configRows.length > 0) {
        text += designer.make({
            title: 'Config',
            header: ['Name', 'Req', 'Description'],
            body: configRows,
        }, w);
    }
    const paramRows = metadataToRows(executor.paramsDescriptor());
    if (paramRows.length > 0) {
        text += designer.make({
            title: 'Params',
            header: ['Name', 'Req', 'Description'],
            body: paramRows,
        }, w);
    }
    text += `Next: ${cmdCb.next?.join(", ") ?? "None"}\n`;
    text += `Prev: ${cmdCb.prev ?? "None"}\n`;
    return text;
};
exports.serviceToString = serviceToString;
const commonToString = (cmdName, cmdCb, maxWidth) => {
    const w = maxWidth ?? DEFAULT_WIDTH;
    let text = `Command /${cmdName}\n  ${cmdCb.description}\n\n`;
    if (cmdCb.args && cmdCb.args.length > 0) {
        text += designer.make({
            title: 'Arguments',
            header: ['Name', 'Req', 'Description'],
            body: cmdCb.args.map(a => [
                a.name,
                a.required ? 'yes' : 'no',
                a.description ?? '',
            ]),
        }, w);
    }
    text += `Next: ${cmdCb.next?.join(", ") ?? `${ui_1.UiUnicodeSymbols.cross} None`}\n`;
    text += `Prev: ${cmdCb.prev ?? `${ui_1.UiUnicodeSymbols.cross} None`}\n`;
    return text;
};
exports.commonToString = commonToString;
const uiCommandsToString = (commands, maxWidth) => {
    const w = maxWidth ?? DEFAULT_WIDTH;
    const body = commands.map(v => [
        `/${v.command}`,
        v.description ?? '',
    ]);
    return designer.make({
        title: `${ui_1.UiUnicodeSymbols.gear} Available commands`,
        header: ['Command', 'Description'],
        body,
    }, w);
};
exports.uiCommandsToString = uiCommandsToString;
const CommonHelp = {
    command: constants_1.BuiltInHelpCommandsEnum.HELP_COMMAND,
    description: "List all available commands.",
    invokable: async function (_, ctx) {
        const w = ctx.manager?.messageWidth ?? undefined;
        const commands = this.toUICommands();
        const commandsStr = (0, exports.uiCommandsToString)(commands, w);
        await ctx.reply(`<pre>${commandsStr}</pre>`, { parse_mode: 'HTML' });
    }
};
exports.CommonHelp = CommonHelp;
class ConcreetHelpArgs {
    command;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 1,
        description: "Command name",
        defaultValue: "help",
        pairOptions: async (_, handler) => {
            return handler.toUICommands().map(c => c.command);
        }
    }),
    __metadata("design:type", String)
], ConcreetHelpArgs.prototype, "command", void 0);
const ConcreetHelp = {
    command: constants_1.BuiltInHelpCommandsEnum.CHELP_COMMAND,
    description: "Print help for concreet command",
    args: ConcreetHelpArgs,
    invokable: async function (args, ctx) {
        const command = args.getOrThrow('command');
        try {
            const w = ctx.manager?.messageWidth ?? undefined;
            const cb = this.getInvokable(command);
            const commandHelpStr = (0, command_1.isService)(cb.invokable) ? (0, exports.serviceToString)(command, cb, w) : (0, exports.commonToString)(command, cb, w);
            await ctx.reply(`<pre>${commandHelpStr}</pre>`, { parse_mode: 'HTML' });
        }
        catch (e) {
            if (e && typeof e === 'object' && 'success' in e) {
                await ctx.reply(e.text);
            }
            await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Unknown error:\n -- ${(0, misc_1.anyToString)(e)}`);
        }
    }
};
exports.ConcreetHelp = ConcreetHelp;
