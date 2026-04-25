"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseInterpreterComponent = void 0;
const lexer_1 = require("./../lexer");
const ui_1 = require("../../../../../ui");
const default_callbacks_1 = require("./../../default-callbacks");
const state_1 = require("../../../../../types/state");
const ev_result_1 = require("../../ev-result");
const chain_1 = require("../../../../../utils/chain");
const arg_proxy_1 = require("../../../../../ui/command-processor/arg-proxy");
class BaseInterpreterComponent extends state_1.AbstractState {
    lexer;
    parser;
    constructor(parser) {
        super();
        this.parser = parser;
        this.lexer = new lexer_1.Lexer();
        this.parser.applyHandler((0, chain_1.chainHandlerFactory)(function (req) {
            const { tkn } = req;
            if (tkn.type == 'TEXT' && tkn.value && tkn.value === default_callbacks_1.BuilderActionSigns.cancelBuild) {
                return 'cancel';
            }
            return;
        }, this));
        this.parser.applyHandler((0, chain_1.chainHandlerFactory)(function (req) {
            const { tkn } = req;
            if (tkn.type == 'TEXT' && this.parser.State === 'IDLE' && tkn.value && tkn.value === default_callbacks_1.BuilderActionSigns.execute) {
                return 'execute';
            }
            return;
        }, this));
        this.parser.applyHandler((0, chain_1.chainHandlerFactory)(function (req) {
            const { tkn } = req;
            if (tkn.type == 'TEXT' && tkn.value && tkn.value === default_callbacks_1.BuilderActionSigns.cancelOp) {
                return 'cancel-op';
            }
            return;
        }, this));
    }
    step(input) {
        this.lexer.setInput(input);
        const tokens = this.lexer.tokenizeCurrent();
        if (tokens.length === 0) {
            return this.end();
        }
        let lastEv;
        for (const tkn of tokens) {
            const action = this.parser.parseNextToken(tkn);
            lastEv = this.processAction(action, tkn);
        }
        return lastEv;
    }
    processAction(action, token) {
        switch (action) {
            case 'none':
                return new ev_result_1.EvaluationResult(this.parser, 'nothing to do', { done: false });
            case 'cancel':
                return new ev_result_1.EvaluationResult(this.parser, `Build canceled by user`, { done: true, addTo: 'end' });
            case 'cancel-op':
                this.parser.back();
                return new ev_result_1.EvaluationResult(this.parser, `${ui_1.UiUnicodeSymbols.cross} Operation canceled by user`, { done: false, addTo: 'end' });
            case 'execute':
                const compiled = this.compile();
                return new ev_result_1.EvaluationResult(this.parser, `${ui_1.UiUnicodeSymbols.success} Build success`, { compiled: compiled, addTo: 'end' });
            case 'set-pair':
                return new ev_result_1.EvaluationResult(this.parser, `Pair name and value was set.`);
            case 'set-pair-name':
                return new ev_result_1.EvaluationResult(this.parser, `Pair name was set.`);
            case 'set-pair-value':
                return new ev_result_1.EvaluationResult(this.parser, `Pair value was set.`);
            case 'set-standalone':
                return new ev_result_1.EvaluationResult(this.parser, `Standalone option was set.`);
            case 'unset-standalone':
                return new ev_result_1.EvaluationResult(this.parser, `Standalone option was unset.`);
            case 'set-positional':
                return new ev_result_1.EvaluationResult(this.parser, `Positional argument was set.`);
            case 'ctx-switch':
                return new ev_result_1.EvaluationResult(this.parser, `Reading context switched to new.`);
            case 'ctx-selection':
                return new ev_result_1.EvaluationResult(this.parser, `Context selection started.`);
            case 'removed-pair':
                return new ev_result_1.EvaluationResult(this.parser, `Pair was removed.`);
            case 'removed-standalone':
                return new ev_result_1.EvaluationResult(this.parser, `Standalone was removed.`);
            case 'removed-positional':
                return new ev_result_1.EvaluationResult(this.parser, `Positional was removed.`);
            case 'value-validation-failed':
                return new ev_result_1.EvaluationResult(this.parser, `${ui_1.UiUnicodeSymbols.error} - Value "${token.value}" validation failed.`);
            case 'wait-next-inited':
                return new ev_result_1.EvaluationResult(this.parser, `Waiting for next value.`);
            default:
                return new ev_result_1.EvaluationResult(this.parser, `${ui_1.UiUnicodeSymbols.error} - Unexpected action: "${action}" on token "${JSON.stringify(token)}"`, { done: true, error: `Unexpected action: ${action}`, addTo: 'end' });
        }
    }
    end() {
        return new ev_result_1.EvaluationResult(this.parser, '', { done: true });
    }
    compile() {
        return {
            command: this.parser.Command,
            proxy: new arg_proxy_1.CmdArgumentProxy(this.parser.ReadArgs),
            raw: this.parser.ReadArgs
        };
    }
}
exports.BaseInterpreterComponent = BaseInterpreterComponent;
