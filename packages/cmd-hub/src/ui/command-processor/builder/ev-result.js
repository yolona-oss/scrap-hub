"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EvaluationResult = void 0;
const builder_markuper_1 = require("./builder-markuper");
class EvaluationResult {
    done;
    markup;
    compiled;
    error;
    constructor(parser, info, config = {}) {
        this.done = config.compiled ? true : (config.done ?? false);
        this.compiled = config.compiled;
        this.error = config.error;
        this.markup = builder_markuper_1.BuilderMarkuper.markup(parser, {
            text: {
                info: info,
                addTo: config.addTo
            },
        });
    }
    get Done() {
        return this.done;
    }
    get Markup() {
        return this.markup;
    }
    get HasError() {
        return Boolean(this.error);
    }
    get Error() {
        return this.error ?? "unknown error";
    }
    get IsCompiled() {
        return Boolean(this.compiled);
    }
    get Result() {
        if (this.IsCompiled) {
            return this.compiled;
        }
        else {
            throw new Error(`Assesing to built result but there are not done`);
        }
    }
}
exports.EvaluationResult = EvaluationResult;
