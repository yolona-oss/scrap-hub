"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HandleInvokation = void 0;
const logger_1 = __importDefault(require("../../../application/logger"));
const abstract_handler_1 = require("./abstract-handler");
const misc_1 = require("../../../utils/misc");
const ui_1 = require("../../../ui");
class HandleInvokation extends abstract_handler_1.AbstractCmdHandler {
    async handle(request) {
        const { command, uiCtx, userId, words: args, dispatcher, uiImpl } = request;
        let res;
        try {
            const compiled = await dispatcher.CommandBuilder.compile(userId, command, args.join(' '), uiCtx, dispatcher);
            const invoker = dispatcher.RemoteInvoker;
            if (!invoker) {
                return {
                    success: false,
                    markup: {
                        text: `${ui_1.UiUnicodeSymbols.error} No remote invoker attached to dispatcher`,
                    },
                };
            }
            res = await invoker.invokeLegacy(userId, compiled.Result, uiCtx, uiImpl);
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
        if (res?.success) {
            return res;
        }
        else {
            uiCtx.reply(`${ui_1.UiUnicodeSymbols.error} Command ${ui_1.UiUnicodeSymbols.arrowRight} "${command}" failed:\n -- ${ui_1.UiUnicodeSymbols.warning} ${res?.markup?.text ?? ui_1.UiUnicodeSymbols.warning + " unknown error"}`);
        }
        return await super.handle(request);
    }
}
exports.HandleInvokation = HandleInvokation;
