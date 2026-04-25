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
exports.SInfoCommand = void 0;
const constants_1 = require("../constants");
const command_1 = require("../../../ui/types/command");
const ui_1 = require("../../../ui");
const table_designer_1 = require("../../../utils/table-designer");
const common_1 = require("@cmd-hub/common");
class SInfoArgs {
    service;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 1,
        description: "Service name",
        pairOptions: async (_, handler, owner) => {
            return handler.UserActiveServices(String(owner.userId)).map(s => s.name)
                .concat(handler.getRegistredServiceNames())
                .filter((v, i, a) => a.indexOf(v) === i);
        }
    }),
    __metadata("design:type", String)
], SInfoArgs.prototype, "service", void 0);
function flattenObject(obj, prefix = '', maxDepth = 3, depth = 0) {
    const result = [];
    if (depth >= maxDepth) {
        result.push({ key: prefix || '(root)', value: typeof obj === 'object' ? '{...}' : String(obj) });
        return result;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj))
        return result;
    for (const [key, val] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            result.push(...flattenObject(val, fullKey, maxDepth, depth + 1));
        }
        else if (Array.isArray(val)) {
            result.push({ key: fullKey, value: `[${val.length} items]` });
        }
        else {
            result.push({ key: fullKey, value: String(val ?? '(empty)') });
        }
    }
    return result;
}
exports.SInfoCommand = {
    command: constants_1.BuiltInUiCommandsEnum.SINFO,
    description: "Show service runtime data, saved config, and session state",
    args: new SInfoArgs,
    requires: [common_1.CAP_ManagerRepo, common_1.CAP_AccountRepo],
    invokable: async function (args, ctx) {
        const repos = this.requireRepos('sinfo');
        const userId = String(ctx.manager.userId);
        const serviceName = args.getPos(1) ?? args.get('service');
        if (!serviceName) {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.info} Usage: /sinfo <service>`);
            return;
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
        const designer = new table_designer_1.TableDesigner();
        const w = ctx.manager?.messageWidth ?? 72;
        let text = `${ui_1.UiUnicodeSymbols.gear} Service info: ${serviceName}\n`;
        const activeService = this.UserActiveServices(userId).find(s => s.name === serviceName);
        if (activeService) {
            text += `${ui_1.UiUnicodeSymbols.success} Status: RUNNING | Session: ${activeService.SessionId}\n\n`;
            const liveData = activeService.runtimeData;
            const cfgFields = flattenObject(liveData.config ?? {});
            if (cfgFields.length > 0) {
                text += designer.make({
                    title: `${ui_1.UiUnicodeSymbols.gear} Runtime config`,
                    header: ['Key', 'Value'],
                    body: cfgFields.map(f => [f.key, f.value]),
                }, w);
            }
            const paramFields = flattenObject(liveData.params ?? {});
            if (paramFields.length > 0) {
                text += designer.make({
                    title: `${ui_1.UiUnicodeSymbols.magnifierGlass} Runtime params`,
                    header: ['Key', 'Value'],
                    body: paramFields.map(f => [f.key, f.value]),
                }, w);
            }
            const sessFields = flattenObject(liveData.sessionData ?? {});
            if (sessFields.length > 0) {
                text += designer.make({
                    title: `${ui_1.UiUnicodeSymbols.clock} Session data`,
                    header: ['Key', 'Value'],
                    body: sessFields.map(f => [f.key, f.value]),
                }, w);
            }
        }
        else {
            text += `${ui_1.UiUnicodeSymbols.info} Status: NOT RUNNING\n\n`;
        }
        try {
            const { module } = await account.getModuleByNameOrCreate(serviceName);
            const moduleData = module.record.data;
            const dbCfg = flattenObject(moduleData.config ?? {});
            if (dbCfg.length > 0) {
                text += designer.make({
                    title: `${ui_1.UiUnicodeSymbols.lock} DB module config`,
                    header: ['Key', 'Value'],
                    body: dbCfg.map(f => [f.key, f.value]),
                }, w);
            }
            else {
                text += `${ui_1.UiUnicodeSymbols.lock} DB module config: (empty)\n`;
            }
            const sessions = await module.getSessions();
            if (sessions.length > 0) {
                text += designer.make({
                    title: `${ui_1.UiUnicodeSymbols.clock} DB sessions`,
                    header: ['Session', 'Fields'],
                    body: sessions.map(sess => {
                        const sessData = flattenObject(sess.record.data ?? {});
                        return [sess.record.name, String(sessData.length)];
                    }),
                }, w);
            }
        }
        catch (_) {
            text += `${ui_1.UiUnicodeSymbols.info} No saved module data in DB.\n`;
        }
        if (text.length > 3900) {
            text = text.slice(0, 3897) + '...';
        }
        await ctx.reply(`<pre>${text}</pre>`, { parse_mode: 'HTML' });
    }
};
