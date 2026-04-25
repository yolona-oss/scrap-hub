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
exports.ServiceListCommand = exports.ServiceSendMsgCommand = exports.ServiceRunCommand = exports.ServiceStopCommand = void 0;
const command_1 = require("../../../ui/types/command");
const constants_1 = require("../constants");
const misc_1 = require("../../../utils/misc");
const ui_1 = require("../../../ui");
const arg_proxy_1 = require("../arg-proxy");
class ServiceStopArgs {
    service;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 1,
        description: "Service name to stop",
        pairOptions: async (_, handler, owner) => {
            return handler.ActiveServices.get(String(owner.userId))?.map(s => s.name) ?? [];
        }
    }),
    __metadata("design:type", String)
], ServiceStopArgs.prototype, "service", void 0);
const ServiceStopCommand = {
    command: constants_1.BuiltInServiceCommandsEnum.STOP_COMMAND,
    description: "Stop service with passed name <service-name>.",
    args: ServiceStopArgs,
    invokable: async function (args, ctx) {
        const userId = String(ctx.manager.userId);
        const serviceName = args.getOrThrow('service');
        try {
            const res = await this.terminateService(userId, serviceName);
            await ctx.reply(`${ui_1.UiUnicodeSymbols.success} Service "${serviceName}" terminated: ${res ?? "No-service-response"}`);
        }
        catch (e) {
            throw new Error(`${ui_1.UiUnicodeSymbols.error} Service "${serviceName}" termination error:\n  -- ${(0, misc_1.anyToString)(e)}.`);
        }
    }
};
exports.ServiceStopCommand = ServiceStopCommand;
class ServiceRunArgs {
    service;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 1,
        description: "Service name to run",
        pairOptions: async (_, handler, __) => {
            return handler.getRegistredServiceNames();
        }
    }),
    __metadata("design:type", String)
], ServiceRunArgs.prototype, "service", void 0);
const ServiceRunCommand = {
    command: constants_1.BuiltInServiceCommandsEnum.RUN_COMMAND,
    description: "Run service with passed name <service-name>. NOCONFIG!!!",
    args: ServiceRunArgs,
    invokable: async function (args, ctx, uiImpl) {
        const userId = String(ctx.manager.userId);
        const serviceName = args.getOrThrow('service');
        try {
            const invoker = this.RemoteInvoker;
            if (!invoker) {
                await ctx.reply(`${ui_1.UiUnicodeSymbols.error} No remote invoker attached.`);
                return;
            }
            const res = await invoker.invokeLegacy(userId, { command: serviceName, proxy: new arg_proxy_1.CmdArgumentProxy([]), raw: [] }, ctx, uiImpl);
            await ctx.reply(`${ui_1.UiUnicodeSymbols.success} Service "${serviceName}" started: ${JSON.stringify(res)}`);
        }
        catch (e) {
            await ctx.reply(`Service ${serviceName} termination error: ${(0, misc_1.anyToString)(e)}.`);
        }
    }
};
exports.ServiceRunCommand = ServiceRunCommand;
class ServiceSendMsgArgs {
    service;
    message;
    args;
}
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 1,
        description: "Service name to send message",
        pairOptions: async function (_, dispatcher, owner) {
            return dispatcher.UserActiveServices(String(owner.userId)).map(s => s.name);
        }
    }),
    __metadata("design:type", String)
], ServiceSendMsgArgs.prototype, "service", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: true,
        position: 2,
        description: "Message name",
        pairOptions: async (serviceName, handler, __) => {
            try {
                const cb = handler.getInvokable(serviceName);
                if ((0, command_1.isFunc)(cb.invokable)) {
                    throw new Error(`Command "${serviceName}" is not a service.`);
                }
                const instance = cb.invokable;
                const messages = instance.receiveMsgDescriptor();
                return Object.keys(messages);
            }
            catch (e) {
                return [];
            }
        }
    }),
    __metadata("design:type", String)
], ServiceSendMsgArgs.prototype, "message", void 0);
__decorate([
    (0, command_1.CmdArgument)({
        required: false,
        position: 3,
        description: "Message additional args",
        pairOptions: []
    }),
    __metadata("design:type", String)
], ServiceSendMsgArgs.prototype, "args", void 0);
const ServiceSendMsgCommand = {
    command: constants_1.BuiltInServiceCommandsEnum.SEND_MSG_COMMAND,
    description: "Send message to service with passed name <service-name> and <message> with optional args.",
    args: ServiceSendMsgArgs,
    invokable: async function (args, ctx) {
        const userId = String(ctx.manager.userId);
        const serviceName = args.getOrThrow('service');
        const messageName = args.getOrThrow('message');
        const messageArgs = args.get('args') ?? '';
        try {
            const activeService = this.UserActiveServices(userId).find(s => s.name === serviceName);
            if (!activeService) {
                throw new Error(`Service ${serviceName} not found`);
            }
            const res = await activeService.receiveMsg(messageName, messageArgs.split(' '));
            await ctx.reply(`Message ${messageName} sent: ${res}`);
        }
        catch (e) {
            await ctx.reply(`Message ${messageName} sending error: ${(0, misc_1.anyToString)(e)}.`);
        }
    }
};
exports.ServiceSendMsgCommand = ServiceSendMsgCommand;
const ServiceListCommand = {
    command: constants_1.BuiltInServiceCommandsEnum.LIST_COMMAND,
    description: "Show all available and active services.",
    invokable: async function (_args, ctx) {
        const userId = String(ctx.manager.userId);
        const registeredNames = this.getRegistredServiceNames();
        const activeServices = this.UserActiveServices(userId);
        let text = `${ui_1.UiUnicodeSymbols.gear} Available services:\n`;
        for (const name of registeredNames) {
            const active = activeServices.find(s => s.name === name);
            const status = active
                ? `${ui_1.UiUnicodeSymbols.success} running`
                : `${ui_1.UiUnicodeSymbols.info} idle`;
            text += ` ${ui_1.UiUnicodeSymbols.arrowRight} ${name}  [${status}]\n`;
        }
        if (activeServices.length > 0) {
            const userOnly = activeServices.filter(s => !registeredNames.includes(s.name));
            if (userOnly.length > 0) {
                text += `\n${ui_1.UiUnicodeSymbols.star} Other active:\n`;
                for (const s of userOnly) {
                    text += ` ${ui_1.UiUnicodeSymbols.arrowRight} ${s.name}  [${ui_1.UiUnicodeSymbols.success} running]\n`;
                }
            }
        }
        if (registeredNames.length === 0) {
            text = `${ui_1.UiUnicodeSymbols.info} No services registered.`;
        }
        await ctx.reply(text);
    }
};
exports.ServiceListCommand = ServiceListCommand;
