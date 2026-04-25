"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CancelSeqCommand = exports.BackInSeqCommand = exports.NextInSeqCommand = void 0;
const logger_1 = __importDefault(require("../../../application/logger"));
const constants_1 = require("../constants");
const misc_1 = require("../../../utils/misc");
async function handle(ctx, cmd) {
    const userId = String(ctx.manager.userId);
    try {
        const res = this.SequenceHandler.handle(userId, cmd);
        if (res) {
            if (res.markup?.text) {
                await ctx.reply(res.markup?.text);
            }
            if (!res.success) {
                throw new Error(`${res.markup?.text ?? "Unknown error"}`);
            }
        }
    }
    catch (e) {
        logger_1.default.error(`Sequence handling error: ` + e);
        await ctx.reply(`Sequence handling error: ${(0, misc_1.anyToString)(e)}`);
    }
}
const NextInSeqCommand = {
    command: constants_1.BuiltInSeqCommandsEnum.NEXT_COMMAND,
    description: "Proceed in current command sequnce.",
    invokable: async function (_, ctx) {
        await handle.bind(this)(ctx, constants_1.BuiltInSeqCommandsEnum.NEXT_COMMAND);
    }
};
exports.NextInSeqCommand = NextInSeqCommand;
const BackInSeqCommand = {
    command: constants_1.BuiltInSeqCommandsEnum.BACK_COMMAND,
    description: "Go back in current command sequnce.",
    invokable: async function (_, ctx) {
        await handle.bind(this)(ctx, constants_1.BuiltInSeqCommandsEnum.BACK_COMMAND);
    }
};
exports.BackInSeqCommand = BackInSeqCommand;
const CancelSeqCommand = {
    command: constants_1.BuiltInSeqCommandsEnum.CANCEL_COMMAND,
    description: "Cancel current command sequnce.",
    invokable: async function (_, ctx) {
        await handle.bind(this)(ctx, constants_1.BuiltInSeqCommandsEnum.CANCEL_COMMAND);
    }
};
exports.CancelSeqCommand = CancelSeqCommand;
