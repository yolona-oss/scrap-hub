"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InterpreterModeNonMandatory = void 0;
const ui_unicode_symbols_1 = require("../../../../../ui/ui-unicode-symbols");
const ev_result_1 = require("../../ev-result");
const base_1 = require("./base");
class InterpreterModeNonMandatory extends base_1.BaseInterpreterComponent {
    step(casulaInput) {
        super.step(casulaInput);
        const compiled = this.compile();
        return new ev_result_1.EvaluationResult(this.parser, `Inclusive build done ${ui_unicode_symbols_1.UiUnicodeSymbols.hammer}`, { compiled });
    }
}
exports.InterpreterModeNonMandatory = InterpreterModeNonMandatory;
