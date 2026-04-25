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
exports.SConfigCommand = void 0;
const constants_1 = require("../constants");
const command_1 = require("../../../ui/types/command");
const ui_1 = require("../../../ui");
const table_designer_1 = require("../../../utils/table-designer");
const validation_1 = require("../../../utils/validation");
const common_1 = require("@cmd-hub/common");
class SConfigArgs {
    service;
    key;
    value;
    clear;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 1,
        description: "Service name",
        pairOptions: async (_, handler) => handler.getRegistredServiceNames()
    }),
    __metadata("design:type", String)
], SConfigArgs.prototype, "service", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 2,
        description: "Config key to set"
    }),
    __metadata("design:type", String)
], SConfigArgs.prototype, "key", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 3,
        description: "New value"
    }),
    __metadata("design:type", String)
], SConfigArgs.prototype, "value", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        standalone: true,
        description: "Clear all saved config for the service"
    }),
    __metadata("design:type", String)
], SConfigArgs.prototype, "clear", void 0);
function flattenObject(obj, prefix = '') {
    const result = [];
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        return result;
    for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            result.push(...flattenObject(val, fullKey));
        }
        else {
            result.push({ key: fullKey, value: val });
        }
    }
    return result;
}
function maskSensitive(key, value) {
    const str = String(value ?? '');
    const sensitiveKeys = ['token', 'key', 'secret', 'password', 'apikey', 'authtoken', 'credentials'];
    const isSensitive = sensitiveKeys.some(s => key.toLowerCase().includes(s));
    if (isSensitive && str.length > 6) {
        return str.slice(0, 3) + '...' + str.slice(-3);
    }
    return str;
}
exports.SConfigCommand = {
    command: constants_1.BuiltInUiCommandsEnum.SCONFIG,
    description: "View or edit saved service configs",
    args: new SConfigArgs,
    requires: [common_1.CAP_ManagerRepo, common_1.CAP_AccountRepo],
    invokable: async function (args, ctx) {
        const repos = this.requireRepos('sconfig');
        const serviceName = args.getPos(1) ?? args.get('service');
        const key = args.getPos(2) ?? args.get('key');
        const doClear = args.has('clear');
        let value = args.getPos(3) ?? args.get('value');
        const rawText = ctx.text;
        if (key && rawText) {
            const keyIdx = rawText.indexOf(key);
            if (keyIdx >= 0) {
                const rawValue = rawText.slice(keyIdx + key.length).trim();
                if (rawValue)
                    value = rawValue;
            }
        }
        const owner = await repos.manager.findByUserId(ctx.manager.userId);
        if (!owner) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Manager not found`);
            return;
        }
        if (!owner.accountId) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Manager has no account`);
            return;
        }
        const account = await repos.account.handleById(owner.accountId);
        if (!account) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Account not found`);
            return;
        }
        if (!serviceName) {
            const serviceNames = this.getRegistredServiceNames();
            let text = `${ui_1.UiUnicodeSymbols.gear} Saved service configs:\n`;
            let hasAny = false;
            for (const name of serviceNames) {
                try {
                    const { module } = await account.getModuleByNameOrCreate(name);
                    const config = (module.record.data.config ?? {});
                    if (Object.keys(config).length > 0) {
                        const fields = flattenObject(config);
                        text += ` ${ui_1.UiUnicodeSymbols.arrowRight} ${name} (${fields.length} fields)\n`;
                        hasAny = true;
                    }
                }
                catch (_) { }
            }
            if (!hasAny) {
                text += ` ${ui_1.UiUnicodeSymbols.info} No saved configs yet. Start a service to create one.\n`;
            }
            text += `\nUse /sconfig <service> to view details.`;
            await ctx.reply(text);
            return;
        }
        const { module } = await account.getModuleByNameOrCreate(serviceName);
        if (doClear) {
            await module.replaceConfig({});
            await ctx.reply(`${ui_1.UiUnicodeSymbols.success} Cleared ${serviceName} config. Defaults will be used on next start.`);
            return;
        }
        if (key && value) {
            if (!(0, validation_1.isValidConfigPath)(key)) {
                await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Invalid config key: "${key}"`);
                return;
            }
            let parsedValue = value;
            try {
                parsedValue = JSON.parse(value);
            }
            catch (_) { }
            if (typeof parsedValue === 'object' && JSON.stringify(parsedValue).length > 10000) {
                await ctx.reply(`${ui_1.UiUnicodeSymbols.error} Value too large`);
                return;
            }
            await module.setDataPath(`config.${key}`, parsedValue);
            const display = typeof parsedValue === 'object' ? JSON.stringify(parsedValue).slice(0, 100) : String(parsedValue);
            await ctx.reply(`${ui_1.UiUnicodeSymbols.success} Set ${serviceName}.${key} = ${maskSensitive(key, display)}`);
            return;
        }
        const config = (module.record.data.config ?? {});
        if (Object.keys(config).length === 0) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.info} No saved config for "${serviceName}". Start the service to create one.`);
            return;
        }
        const fields = flattenObject(config);
        const designer = new table_designer_1.TableDesigner();
        const table = designer.make({
            title: `${ui_1.UiUnicodeSymbols.gear} ${serviceName} config`,
            header: ['Key', 'Value'],
            body: fields.map(({ key: k, value: v }) => [k, maskSensitive(k, v)]),
        }, ctx.manager?.messageWidth ?? 72);
        await ctx.reply(`<pre>${table}</pre>Use /sconfig ${serviceName} &lt;key&gt; &lt;value&gt; to update.`, { parse_mode: 'HTML' });
    }
};
