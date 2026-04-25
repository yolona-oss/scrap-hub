"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HandleCmdBuilder = void 0;
const abstract_handler_1 = require("./abstract-handler");
const base_ui_1 = require("../../../ui/base-ui");
const builder_1 = require("../builder");
const logger_1 = __importDefault(require("../../../application/logger"));
const desc_compiler_1 = require("../builder/desc-compiler");
class HandleCmdBuilder extends abstract_handler_1.AbstractCmdHandler {
    async startNewBuild(userId, command, args, ctx, builder, dispatcher) {
        logger_1.default.trace(`Checking for availability to start build: ${command}`);
        logger_1.default.trace(`Command: ${command}\nArgs: ${args}`);
        if (!dispatcher.isAllArgsPassed(command, args)) {
            const avalibleCtxs = builder_1.CommandBuilder.selectReadingContexts(command, userId, dispatcher);
            const descCompiler = new desc_compiler_1.CBDescriptorCompiler();
            let desc = await descCompiler.compile(command, userId, dispatcher, ctx);
            let savedData;
            if (dispatcher.isService(command)) {
                try {
                    const repos = dispatcher.repos;
                    if (repos && ctx.manager?.userId !== undefined) {
                        const owner = await repos.manager.findByUserId(ctx.manager.userId);
                        if (owner?.accountId) {
                            const account = await repos.account.handleById(owner.accountId);
                            if (account) {
                                const { module } = await account.getModuleByNameOrCreate(command);
                                savedData = (module.record.data.config ?? undefined);
                            }
                        }
                    }
                }
                catch (_) { }
            }
            const res = builder.startBuild(userId, command, desc, avalibleCtxs, undefined, savedData);
            return {
                success: true,
                markup: res,
                messageType: 'builder'
            };
        }
        return;
    }
    async handleBuildProcess(userId, text, ctx, builder, dispatcher, uiImpl) {
        if (builder.isUserOnBuild(userId)) {
            const stepRes = builder.handle(userId, text);
            if (stepRes.IsCompiled) {
                logger_1.default.trace(`Build done: invoking command: ${stepRes.Result.command}`);
                if (uiImpl instanceof base_ui_1.BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000);
                }
                const invoker = dispatcher.RemoteInvoker;
                if (!invoker) {
                    return {
                        success: false,
                        markup: { text: 'No remote invoker attached to dispatcher' },
                        messageType: 'system',
                    };
                }
                return await invoker.invokeLegacy(userId, stepRes.Result, ctx, uiImpl);
            }
            if (stepRes.Done) {
                if (uiImpl instanceof base_ui_1.BaseUI) {
                    uiImpl.lifecycle.scheduleCleanupByType(userId, 'builder', 5_000);
                }
            }
            return {
                success: !Boolean(stepRes),
                markup: stepRes.Markup,
                messageType: 'builder'
            };
        }
        return;
    }
    async handle(request) {
        const { command, text, userId, uiCtx, uiImpl, words: args, dispatcher } = request;
        const builder = dispatcher.CommandBuilder;
        const builderRes = await this.handleBuildProcess(userId, text, uiCtx, builder, dispatcher, uiImpl);
        if (builderRes) {
            return builderRes;
        }
        try {
            const buildSetupRes = await this.startNewBuild(userId, command, args, uiCtx, builder, dispatcher);
            if (buildSetupRes) {
                return buildSetupRes;
            }
        }
        catch (e) {
            logger_1.default.error(`Cannot start build command: "${command}": ${e?.message ?? e}`, e);
        }
        return await super.handle(request);
    }
}
exports.HandleCmdBuilder = HandleCmdBuilder;
