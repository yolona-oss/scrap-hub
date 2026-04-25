"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommandBuilder = void 0;
const ui_1 = require("../../../ui");
const desc_compiler_1 = require("./desc-compiler");
const interpreter_1 = require("./interpreter");
const builder_markuper_1 = require("./builder-markuper");
const parser_1 = require("./interpreter/parser");
const array_1 = require("../../../utils/array");
const misc_1 = require("../../../utils/misc");
const default_callbacks_1 = require("./default-callbacks");
const logger_1 = __importDefault(require("../../../application/logger"));
class CommandBuilder {
    usersBuild = new Map();
    constructor() { }
    static selectReadingContexts(command, userId, dispatcher) {
        const isService = dispatcher.isService(command);
        const isActive = dispatcher.isServiceActive(userId, command);
        return isService ?
            isActive ?
                ['message'] :
                ['params', 'config'] :
            ['args'];
    }
    isUserOnBuild(userId) {
        if (this.usersBuild.has(userId)) {
            return true;
        }
        return false;
    }
    stopBuild(userId) {
        this.usersBuild.delete(userId);
    }
    handle(userId, input) {
        const interpreter = this.usersBuild.get(userId);
        if (!interpreter) {
            throw new Error(`User "${userId}" not on build`);
        }
        const res = interpreter.step(input);
        if (res.Done) {
            this.stopBuild(userId);
        }
        return res;
    }
    startBuild(userId, command, desc, contexts, mode, savedData) {
        if (this.usersBuild.has(userId)) {
            throw new Error("User already has active build.");
        }
        const uniqCtxs = (0, array_1.unique)(contexts);
        if (uniqCtxs.length === 0) {
            throw new Error("No avalible contexts.");
        }
        if (desc.args.length === 0) {
            throw new Error("No arguments in descriptor. Nothing to build.");
        }
        const ctxWithRequired = uniqCtxs.find(ctx => desc.args.some(a => a.ctx === ctx && a.required));
        const initialCtx = ctxWithRequired ?? uniqCtxs.find(c => c === 'config') ?? uniqCtxs[0];
        const state = new parser_1.CBParser({
            command,
            descriptor: desc,
            avaliableArgCtxs: uniqCtxs,
            switchArgCtxKeyword: default_callbacks_1.BuilderActionSigns.switchCtx,
            initialArgCtx: initialCtx
        });
        state.SavedData = savedData;
        const interpreter = new interpreter_1.CBInterpreter(state, mode);
        this.usersBuild.set(userId, interpreter);
        return builder_markuper_1.BuilderMarkuper.__tmpMarkup(state, savedData);
    }
    async compile(userId, command, input, ctx, dispatcher) {
        logger_1.default.trace(`CommandBuilder: Starting non-mandatory compilation for command: ${command}`);
        const desc_compiler = new desc_compiler_1.CBDescriptorCompiler();
        const descriptor = await desc_compiler.compile(command, userId, dispatcher, ctx);
        const argContexts = CommandBuilder.selectReadingContexts(command, userId, dispatcher);
        const parser = new parser_1.CBParser({
            command,
            avaliableArgCtxs: argContexts,
            descriptor,
            switchArgCtxKeyword: default_callbacks_1.BuilderActionSigns.switchCtx,
            initialArgCtx: 'args'
        });
        const interpreter = new interpreter_1.CBInterpreter(parser, 'non-mandatory');
        try {
            const compiled = interpreter.step(input);
            return compiled;
        }
        catch (e) {
            throw new Error(`${ui_1.UiUnicodeSymbols.cross} Non crendary compilation failed.\n
-- ${ui_1.UiUnicodeSymbols.magnifierGlass} Input: ${ui_1.UiUnicodeSymbols.arrowRight} "${input}".\n
-- ${ui_1.UiUnicodeSymbols.magnifierGlass} Error: ${ui_1.UiUnicodeSymbols.arrowRight} "${(0, misc_1.anyToString)(e) || "Unknown error"}"`);
        }
    }
}
exports.CommandBuilder = CommandBuilder;
