"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterpreterModeComprehensive = void 0;
const ev_result_1 = require("../../ev-result");
const base_1 = require("./base");
class InterpreterModeComprehensive extends base_1.BaseInterpreterComponent {
    step(input) {
        const res = super.step(input);
        if (this.parser.isEveryArgumentsRead()) {
            const compiled = this.compile();
            return new ev_result_1.EvaluationResult(this.parser, `Building command`, { compiled: compiled, addTo: "end" });
        }
        return res;
    }
}
exports.InterpreterModeComprehensive = InterpreterModeComprehensive;
