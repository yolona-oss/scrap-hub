"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CBInterpreter = void 0;
const state_1 = require("../../../../types/state");
const logger_1 = __importDefault(require("../../../../application/logger"));
const ev_result_1 = require("./../ev-result");
const modes_1 = require("./modes");
const modes_2 = require("./modes");
const default_mode = "incremental";
class CBInterpreter extends state_1.AbstractCtx {
    parser;
    mode;
    constructor(parser, mode = default_mode) {
        super(new modes_1.BaseInterpreterComponent(parser));
        this.parser = parser;
        logger_1.default.trace(`CBInterpreter initial mode: ${mode}`);
        this.switchTo(mode);
    }
    switchTo(mode) {
        if (this.mode === mode) {
            logger_1.default.debug(`On interpreter mode switch: Interpreter already in ${mode} mode`);
            return;
        }
        logger_1.default.trace(`Interpreter mode switch to ${mode}`);
        switch (mode) {
            case "comprehensive":
                this.transitionTo(new modes_2.InterpreterModeComprehensive(this.parser));
                break;
            case "required":
                this.transitionTo(new modes_2.InterpreterModeRequired(this.parser));
                break;
            case "non-mandatory":
                this.transitionTo(new modes_2.InterpreterModeNonMandatory(this.parser));
                break;
            case "incremental":
                this.transitionTo(new modes_1.BaseInterpreterComponent(this.parser));
                break;
            default:
                logger_1.default.error(`Interpreter mode switch error: ${mode}. Switching to default mode.`);
                this.transitionTo(new modes_1.BaseInterpreterComponent(this.parser));
        }
        this.mode = mode;
    }
    step(input) {
        try {
            return this.CurrentCtxStateObj.step(input);
        }
        catch (e) {
            logger_1.default.error(`Interpreter error: ${e}`);
            return new ev_result_1.EvaluationResult(this.parser, `Interpreter error: ${e}`);
        }
    }
}
exports.CBInterpreter = CBInterpreter;
