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
exports.DashboardCommand = void 0;
const constants_1 = require("../constants");
const command_1 = require("../../../ui/types/command");
const ui_1 = require("../../../ui");
class DashboardArgs {
    service;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 1,
        description: "Service name to show dashboard for",
        pairOptions: async (_, handler, owner) => {
            return handler.UserActiveServices(String(owner.userId)).map(s => s.name);
        }
    }),
    __metadata("design:type", String)
], DashboardArgs.prototype, "service", void 0);
exports.DashboardCommand = {
    command: constants_1.BuiltInUiCommandsEnum.DASHBOARD,
    description: "Show, foreground, or close a service dashboard",
    args: new DashboardArgs,
    invokable: async function (args, ctx) {
        const userId = String(ctx.manager.userId);
        const serviceName = args.getPos(1);
        if (!serviceName) {
            const active = this.UserActiveServices(userId);
            if (active.length === 0) {
                await ctx.reply(`${ui_1.UiUnicodeSymbols.info} No active services.`);
                return;
            }
            let text = `${ui_1.UiUnicodeSymbols.gear} Active services:\n`;
            for (const s of active) {
                const dash = this.getDashboard(userId, s.name);
                const status = dash
                    ? dash.isAttached
                        ? `${ui_1.UiUnicodeSymbols.success} dashboard live`
                        : `${ui_1.UiUnicodeSymbols.info} dashboard ended`
                    : `${ui_1.UiUnicodeSymbols.warning} no dashboard`;
                text += ` ${ui_1.UiUnicodeSymbols.arrowRight} ${s.name}  [${status}]\n`;
            }
            text += `\nUse /dashboard <name> to foreground a dashboard.`;
            await ctx.reply(text);
            return;
        }
        const dashboard = this.getDashboard(userId, serviceName);
        if (dashboard) {
            await dashboard.reattach();
        }
        else {
            await ctx.reply(`${ui_1.UiUnicodeSymbols.warning} No dashboard for "${serviceName}". Service may not be running or was started with -noDashboard.`);
        }
    }
};
