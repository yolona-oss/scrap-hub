import { AbstractCtx } from "../../../../types/state";
import log from '../../../../application/logger';
import { CBParser } from "./parser";
import { EvaluationResult } from "./../ev-result";
import { BaseInterpreterComponent } from "./modes";

import {
    InterpreterModeComprehensive,
    InterpreterModeRequired,
    InterpreterModeNonMandatory
} from "./modes"

/**
 * @param comprehensive - every argument must be processed
 * @param required - parse will be done on all required arguments read
 * @param non-mandatory - mode to read ready compiled arguments.
 * @param incremental -
 */
export type InterpreterMode = "comprehensive" | "required" | "non-mandatory" | 'incremental'

const default_mode: InterpreterMode = "incremental"

/**
 * @param {CBState} state - interpreter state manager and data manipulator
 * @param {InterpreterMode} mode [mode="required"] - setup interpritation completion triger
 */
export class CBInterpreter extends AbstractCtx<BaseInterpreterComponent> {
    private mode!: InterpreterMode

    constructor(
        private parser: CBParser,
        mode: InterpreterMode = default_mode
    ) {
        super(new BaseInterpreterComponent(parser))
        log.trace(`CBInterpreter initial mode: ${mode}`)
        this.switchTo(mode)
    }

    switchTo(mode: InterpreterMode) {
        if (this.mode === mode) {
            log.debug(`On interpreter mode switch: Interpreter already in ${mode} mode`)
            return
        }

        log.trace(`Interpreter mode switch to ${mode}`)
        switch (mode) {
            case "comprehensive":
                this.transitionTo(new InterpreterModeComprehensive(this.parser))
                break
            case "required":
                this.transitionTo(new InterpreterModeRequired(this.parser))
                break;
            case "non-mandatory":
                this.transitionTo(new InterpreterModeNonMandatory(this.parser))
                break;
            case "incremental":
                this.transitionTo(new BaseInterpreterComponent(this.parser))
                break
            default:
                log.error(`Interpreter mode switch error: ${mode}. Switching to default mode.`)
                this.transitionTo(new BaseInterpreterComponent(this.parser))
        }
        this.mode = mode
    }

    step(input: string): EvaluationResult {
        try {
            return this.CurrentCtxStateObj.step(input)
        } catch(e) {
            log.error(`Interpreter error: ${e}`)
            return new EvaluationResult(this.parser, `Interpreter error: ${e}`)
        }
    }
}
