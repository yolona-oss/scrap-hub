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
exports.ConfigCommand = void 0;
const constants_1 = require("../constants");
const command_1 = require("../../../ui/types/command");
const ui_1 = require("../../../ui");
const config_registry_1 = require("../../../config-registry");
const table_designer_1 = require("../../../utils/table-designer");
class ConfigArgs {
    module;
    key;
    value;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 1,
        description: "Config module name",
        pairOptions: async () => config_registry_1.ConfigRegistry.list()
    }),
    __metadata("design:type", String)
], ConfigArgs.prototype, "module", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 2,
        description: "Config key to set"
    }),
    __metadata("design:type", String)
], ConfigArgs.prototype, "key", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 3,
        description: "New value"
    }),
    __metadata("design:type", String)
], ConfigArgs.prototype, "value", void 0);
function maskValue(value, sensitive) {
    const str = String(value ?? '');
    if (sensitive && str.length > 6) {
        return str.slice(0, 3) + '...' + str.slice(-3);
    }
    return str;
}
exports.ConfigCommand = {
    command: constants_1.BuiltInUiCommandsEnum.CONFIG,
    description: "View or edit app configuration",
    args: new ConfigArgs,
    invokable: async function (args, ctx) {
        const moduleName = args.getPos(1) ?? args.get('module');
        const key = args.getPos(2) ?? args.get('key');
        const value = args.getPos(3) ?? args.get('value');
        if (!moduleName) {
            const modules = config_registry_1.ConfigRegistry.list();
            if (modules.length === 0) {
                await ctx.reply(`${ui_1.UiUnicodeSymbols.info} No config modules registered.`);
                return;
            }
            let text = `${ui_1.UiUnicodeSymbols.gear} Config modules:\n`;
            for (const name of modules) {
                const mod = config_registry_1.ConfigRegistry.getModule(name);
                const fields = await config_registry_1.ConfigRegistry.describe(name);
                text += ` ${ui_1.UiUnicodeSymbols.arrowRight} ${name} [${mod?.scope ?? '?'}] (${fields.length} fields)\n`;
            }
            text += `\nUse /config <module> to view, /config <module> <key> <value> to set.`;
            await ctx.reply(text);
            return;
        }
        if (!config_registry_1.ConfigRegistry.has(moduleName)) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Unknown config module "${moduleName}". Use /config to list modules.`);
            return;
        }
        if (key && value) {
            if (!ctx.manager?.isAdmin) {
                await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Admin access required to modify config`);
                return;
            }
            const mod = config_registry_1.ConfigRegistry.getModule(moduleName);
            const userId = String(ctx.manager.userId);
            await config_registry_1.ConfigRegistry.set(moduleName, key, value, mod?.scope === 'user' ? userId : undefined);
            const target = mod?.scope === 'bootstrap' ? 'config.json' : 'MongoDB';
            await ctx.reply(`${ui_1.UiUnicodeSymbols.success} Set ${moduleName}.${key} = "${value}" (saved to ${target})`);
            const fanout = await this.fanoutConfigReload(moduleName);
            if (fanout && (fanout.notified > 0 || fanout.failed > 0)) {
                await ctx.reply(`${ui_1.UiUnicodeSymbols.info} ConfigReload fan-out: ` +
                    `${fanout.notified} notified, ${fanout.failed} failed`);
            }
            return;
        }
        const userId = String(ctx.manager.userId);
        const fields = await config_registry_1.ConfigRegistry.describe(moduleName, userId);
        if (fields.length === 0) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.info} Module "${moduleName}" has no config fields.`);
            return;
        }
        const designer = new table_designer_1.TableDesigner();
        const table = designer.make({
            title: `${ui_1.UiUnicodeSymbols.gear} ${moduleName} config`,
            header: ['Key', 'Value'],
            body: fields.map(({ key: k, value: v, sensitive }) => [k, maskValue(v, sensitive)]),
        }, ctx.manager?.messageWidth ?? 72);
        await ctx.reply(`<pre>${table}</pre>Use /config ${moduleName} &lt;key&gt; &lt;value&gt; to update.`, { parse_mode: 'HTML' });
    }
};
