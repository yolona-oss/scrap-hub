"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HandleSequenceCommand = void 0;
const misc_1 = require("../../../utils/misc");
const abstract_handler_1 = require("./abstract-handler");
const logger_1 = __importDefault(require("../../../application/logger"));
class HandleSequenceCommand extends abstract_handler_1.AbstractCmdHandler {
    async handle(request) {
        const { command, userId, dispatcher } = request;
        const cb = dispatcher.getInvokable(command);
        if (!cb.seqBounded) {
            return await super.handle(request);
        }
        let res;
        let err;
        const sequenceHandler = dispatcher.SequenceHandler;
        try {
            res = sequenceHandler.handle(userId, command);
        }
        catch (e) {
            err = (0, misc_1.anyToString)(e);
            logger_1.default.error(`Sequence handling error: ` + err);
        }
        if (err && err.length > 0) {
            return {
                success: false,
                markup: {
                    text: err
                }
            };
        }
        if (res) {
            return res;
        }
        return await super.handle(request);
    }
}
exports.HandleSequenceCommand = HandleSequenceCommand;
