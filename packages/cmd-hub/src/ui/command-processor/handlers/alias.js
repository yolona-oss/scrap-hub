"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HandleCommandAlias = void 0;
const abstract_handler_1 = require("./abstract-handler");
const misc_1 = require("../../../utils/misc");
const ui_1 = require("../../../ui");
const logger_1 = __importDefault(require("../../../application/logger"));
class HandleCommandAlias extends abstract_handler_1.AbstractCmdHandler {
    async handle(request) {
        const { command, dispatcher, uiCtx, uiImpl, ownerId } = request;
        const repos = dispatcher.repos;
        if (!repos)
            return super.handle(request);
        const aliasDoc = await repos.cmdAlias.findByOwnerAndAlias(ownerId, command);
        if (!aliasDoc) {
            return super.handle(request);
        }
        const commandStr = aliasDoc.command;
        const commandSplit = commandStr.split(" ");
        const commandName = commandSplit[0];
        const commandArg = commandSplit.slice(1).join(" ");
        if (!dispatcher.isCommandRegistered(commandName)) {
            return {
                success: false,
                markup: {
                    text: `Aliased(${aliasDoc.alias}) command "${commandName}" is not registered.`
                }
            };
        }
        try {
            const compiled = await dispatcher.CommandBuilder.compile(request.userId, commandName, commandArg, uiCtx, dispatcher);
            const invoker = dispatcher.RemoteInvoker;
            if (!invoker) {
                return {
                    success: false,
                    markup: {
                        text: `${ui_1.UiUnicodeSymbols.error} No remote invoker attached to dispatcher`,
                    },
                };
            }
            return await invoker.invokeLegacy(request.userId, compiled.Result, uiCtx, uiImpl);
        }
        catch (e) {
            logger_1.default.error("Command execution error: " + (0, misc_1.anyToString)(e));
            return {
                success: false,
                markup: {
                    text: `${ui_1.UiUnicodeSymbols.error} Command ${ui_1.UiUnicodeSymbols.arrowRight} "${command}" execution error:\n -- ${(0, misc_1.anyToString)(e) || ui_1.UiUnicodeSymbols.warning + " unknown error"}`
                }
            };
        }
    }
}
exports.HandleCommandAlias = HandleCommandAlias;
