"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CBParser = void 0;
const object_1 = require("../../../../utils/object");
const command_1 = require("../../../../ui/types/command");
const state_span_1 = require("./state-span");
const logger_1 = __importDefault(require("../../../../application/logger"));
const chain_1 = require("../../../../utils/chain");
const array_1 = require("../../../../utils/array");
const descriptor_helpers_1 = require("../../../../ui/types/command/argument/descriptor-helpers");
const stateTransiteMap = {
    'IDLE': ['ARG_CTX_SEL', 'STAND_ALONE', 'POSITIONAL', 'PAIR', 'PAIR_VALUE', 'WAIT_NEXT_V', 'IDLE'],
    'ARG_CTX_SEL': ['IDLE'],
    'PAIR_VALUE': ['IDLE'],
    'STAND_ALONE': ['IDLE'],
    'POSITIONAL': ['IDLE'],
    'PAIR': ['PAIR_VALUE'],
    'WAIT_NEXT_V': ['IDLE', 'STAND_ALONE', 'POSITIONAL', 'PAIR']
};
class CBParser {
    command;
    switchArgCtxKeyword;
    avaliableArgCtxs;
    currentArgCtx;
    descriptor;
    state;
    _prevState;
    arguments;
    _savedData;
    snaper = new state_span_1.StateSnaper();
    tknParseChain;
    chainDirty = true;
    constructor(config) {
        logger_1.default.trace(`Parser created for command: ${config.command}\nDescriptor: ${JSON.stringify(config.descriptor, null, 4)}`);
        this.switchArgCtxKeyword = config.switchArgCtxKeyword;
        this.snaper = new state_span_1.StateSnaper();
        this.command = config.command;
        config.avaliableArgCtxs.forEach(ctx => this.validateContext(ctx));
        this.avaliableArgCtxs = config.avaliableArgCtxs;
        config.descriptor.args.forEach(v => {
            if (v.name.trim() == '') {
                throw new Error(`Descriptor Argument name can't be empty`);
            }
        });
        this.descriptor = config.descriptor;
        this.currentArgCtx = config.initialArgCtx ? config.initialArgCtx : this.avaliableArgCtxs[0];
        this.state = 'IDLE';
        this._prevState = this.state;
        this.arguments = [];
        this.tknParseChain = new chain_1.Chain();
    }
    _appliedHandlers = new Array();
    applyHandler(handler) {
        this._appliedHandlers.push(handler);
        this.chainDirty = true;
    }
    waitNextBuf;
    get NextValueSetType() {
        return this.waitNextBuf?.type;
    }
    get NextValueSetValue() {
        return this.waitNextBuf?.value;
    }
    buildChain() {
        this.tknParseChain = new chain_1.Chain();
        const switchArgCtx = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn } = req;
            if (this.state === 'ARG_CTX_SEL' &&
                tkn.type == 'TEXT' &&
                tkn.value &&
                this.IsContextInAvaliable(tkn.value)) {
                this.currentArgCtx = tkn.value;
                this.transitState('IDLE');
                return 'ctx-switch';
            }
            return;
        });
        const switchToArgCtxSelection = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn } = req;
            if (this.state == 'IDLE' &&
                tkn.type == 'TEXT' &&
                tkn.value &&
                tkn.value === this.switchArgCtxKeyword) {
                this.transitState('ARG_CTX_SEL');
                return 'ctx-selection';
            }
            return;
        });
        const validateRequest = (0, chain_1.chainHandlerFactory)((req) => {
            if (req.tkn.value === undefined || req.tkn.value === null) {
                return 'none';
            }
            if (this.state === 'POSITIONAL' && this.waitNextBuf && req.tkn.type === 'TEXT') {
                const bufDesc = this.findDescriptorByName(this.waitNextBuf.value);
                if (bufDesc) {
                    req.desc = bufDesc;
                    return;
                }
            }
            if (this.state === 'POSITIONAL' && (req.tkn.type === 'DOUBLE_DASH' || req.tkn.type === 'SINGLE_DASH')) {
                this.waitNextBuf = undefined;
                this.transitState('IDLE');
            }
            if (this.state === 'PAIR_VALUE' && (req.tkn.type === 'DOUBLE_DASH' || req.tkn.type === 'SINGLE_DASH')) {
                const lastArg = this.arguments[this.arguments.length - 1];
                if (lastArg && (!lastArg.value || lastArg.value === '')) {
                    this.arguments.pop();
                }
                this.transitState('IDLE');
            }
            let desired_name;
            if (this.state === 'PAIR_VALUE') {
                desired_name = this.arguments[this.arguments.length - 1].name;
            }
            else if (this.state == 'WAIT_NEXT_V') {
                desired_name = this.waitNextBuf.value;
            }
            else if (req.tkn.type == 'DOUBLE_DASH' || req.tkn.type == 'SINGLE_DASH') {
                desired_name = req.tkn.value;
            }
            let desc = this.findDescriptorByName(desired_name ?? '');
            if (!desc && !(req.tkn.type == 'DOUBLE_DASH' || req.tkn.type == 'SINGLE_DASH')) {
                if (this.NextPositionalInd <= this.MaxPositionalInd) {
                    desc = this.descriptor.args.find(arg => arg.position === this.NextPositionalInd);
                }
            }
            if (!desc) {
                logger_1.default.debug(`Descriptor for ${desired_name ?? `positional(${this.NextPositionalInd})`} not found`);
                return 'none';
            }
            req.desc = desc;
            return;
        });
        const setWaitNextBuf = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn, desc } = req;
            if (this.state == 'IDLE') {
                const type = (0, descriptor_helpers_1.getArgumentDescType)(desc);
                this.waitNextBuf = {
                    type,
                    value: tkn.value,
                    tokenType: tkn.type
                };
                this.transitState('WAIT_NEXT_V');
                switch (type) {
                    case 'positional':
                        break;
                    case 'pair':
                        if (tkn.type !== 'DOUBLE_DASH') {
                            logger_1.default.debug(`DOUBLE_DASH token expected for descriptor but got ${tkn.type}`);
                            this.state = this._prevState;
                        }
                        break;
                    case 'standalone':
                        break;
                }
            }
            return;
        });
        const transitByBuf = (0, chain_1.chainHandlerFactory)(() => {
            if (this.state == 'WAIT_NEXT_V') {
                if (this.waitNextBuf === undefined) {
                    throw new Error(`Can't set value from undefined next value setting`);
                }
                const bufType = this.waitNextBuf.type;
                const bufTokenType = this.waitNextBuf.tokenType;
                logger_1.default.trace(`transitByBuf: ${JSON.stringify(this.waitNextBuf)}`);
                if (bufType === 'standalone') {
                    this.transitState('STAND_ALONE');
                }
                else if (bufType === 'positional') {
                    this.transitState('POSITIONAL');
                    if (bufTokenType === 'DOUBLE_DASH' || bufTokenType === 'SINGLE_DASH') {
                        return 'wait-next-inited';
                    }
                }
                else if (bufType === 'pair') {
                    this.transitState('PAIR');
                }
                else {
                    throw new Error(`Can't set value from undefined next value setting`);
                }
            }
            return;
        });
        const expectUniqExistance = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn, desc } = req;
            if (this.state === 'POSITIONAL') {
                const pos = desc?.position ?? (tkn.value.startsWith('positional-') ? (0, command_1.decodePositionalName)(tkn.value).position : undefined);
                if (pos !== undefined) {
                    (0, array_1.removeObjectByFieldsMutate)(this.arguments, { position: pos, ctx: this.currentArgCtx });
                }
            }
            else if (this.state === 'PAIR') {
                (0, array_1.removeObjectByFieldsMutate)(this.arguments, { name: tkn.value, ctx: this.currentArgCtx });
            }
        });
        const setPairName = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn, desc } = req;
            if (this.state === 'PAIR') {
                if (!(0, descriptor_helpers_1.isArgumentDescPair)(desc)) {
                    throw new Error(`Argument descriptor is not pair: ${tkn.value}`);
                }
                this.arguments.push((0, descriptor_helpers_1.compileArgumentFromDesc)(desc, ''));
                this.transitState('PAIR_VALUE');
                return 'set-pair-name';
            }
            return;
        });
        const validateArgumentValue = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn, desc } = req;
            if (this.state === 'STAND_ALONE' ||
                this.state === 'POSITIONAL' ||
                this.state === 'PAIR_VALUE') {
                if (!desc.validator(tkn.value)) {
                    return 'value-validation-failed';
                }
            }
            return;
        });
        const setPairValue = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn } = req;
            if (tkn.type == 'TEXT' &&
                this.state == 'PAIR_VALUE' &&
                this.arguments.length !== 0) {
                if (this.LastReadArg.value != '') {
                    throw new Error(`Pair value already set`);
                }
                this.LastReadArg.value = tkn.value;
                this.transitState('IDLE');
                return 'set-pair-value';
            }
            return;
        });
        const setPositional = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn } = req;
            if (this.state == 'POSITIONAL') {
                let desc = req.desc;
                if (this.waitNextBuf && this.waitNextBuf.tokenType !== 'TEXT') {
                    const bufDesc = this.findDescriptorByName(this.waitNextBuf.value);
                    if (bufDesc)
                        desc = bufDesc;
                }
                if (!desc || !(0, descriptor_helpers_1.isArgumentDescPositional)(desc)) {
                    throw new Error(`Argument descriptor is not positional for: ${tkn.value}`);
                }
                (0, array_1.removeObjectByFieldsMutate)(this.arguments, { position: desc.position, ctx: desc.ctx });
                this.arguments.push((0, descriptor_helpers_1.compileArgumentFromDesc)(desc, tkn.value));
                this.waitNextBuf = undefined;
                this.transitState('IDLE');
                return 'set-positional';
            }
            return;
        });
        const setStandalone = (0, chain_1.chainHandlerFactory)((req) => {
            const { tkn, desc } = req;
            if (this.state == 'STAND_ALONE') {
                if (!(0, descriptor_helpers_1.isArgumentDescStandalone)(desc)) {
                    throw new Error(`Argument descriptor is not standalone: ${tkn.value}`);
                }
                const wasAlreadySet = this.isArgumentStandaloneRead(tkn.value);
                (0, array_1.removeObjectByFieldsMutate)(this.arguments, { name: tkn.value, standalone: true, ctx: this.currentArgCtx });
                if (wasAlreadySet) {
                    this.transitState('IDLE');
                    return 'unset-standalone';
                }
                if (desc.validator(tkn.value)) {
                    this.arguments.push((0, descriptor_helpers_1.compileArgumentFromDesc)(desc, tkn.value));
                    this.transitState('IDLE');
                    return 'set-standalone';
                }
                else {
                    this.back();
                }
            }
            return;
        });
        for (const hndl of this._appliedHandlers) {
            this.tknParseChain.use(hndl);
        }
        this.tknParseChain.use(switchToArgCtxSelection);
        this.tknParseChain.use(switchArgCtx);
        this.tknParseChain.use(validateRequest);
        this.tknParseChain.use(setWaitNextBuf);
        this.tknParseChain.use(transitByBuf);
        this.tknParseChain.use(expectUniqExistance);
        this.tknParseChain.use(setPairName);
        this.tknParseChain.use(validateArgumentValue);
        this.tknParseChain.use(setPairValue);
        this.tknParseChain.use(setPositional);
        this.tknParseChain.use(setStandalone);
        this.tknParseChain.use((0, chain_1.createChainFallbackHandler)('none'));
    }
    validateContext(ctx) {
        if (ctx.length == 0) {
            throw new Error(`Invalid context name "${ctx}"`);
        }
        if (/[^a-zA-Z0-9_]/.test(ctx)) {
            throw new Error(`Invalid context name "${ctx}"`);
        }
    }
    toRawState() {
        return (0, object_1.deepClone)({
            command: this.command,
            avaliableCtxs: this.avaliableArgCtxs,
            descriptor: this.descriptor,
            currentCtx: this.currentArgCtx,
            state: this.state,
            arguments: this.arguments,
        });
    }
    snap() {
        this.snaper.memorize({
            currentCtx: this.currentArgCtx,
            state: this.state,
            _prevState: this._prevState,
            args: (0, object_1.deepClone)(this.arguments),
            waitNextBuf: (0, object_1.deepClone)(this.waitNextBuf),
        });
    }
    back() {
        const snap = this.snaper.back;
        if (snap) {
            this.currentArgCtx = snap.currentCtx;
            this.state = snap.state;
            this.arguments = snap.args;
            this._prevState = snap._prevState;
            this.waitNextBuf = snap.waitNextBuf;
        }
        else {
            throw new Error('Can\'t back parser state');
        }
    }
    get State() {
        return this.state;
    }
    get CurrentContext() {
        return this.currentArgCtx;
    }
    get AvaliableContexts() {
        return this.avaliableArgCtxs;
    }
    IsContextInAvaliable(ctx) {
        return this.avaliableArgCtxs.includes(ctx);
    }
    get ReadArgs() {
        return this.arguments;
    }
    get LastReadArg() {
        return this.arguments[this.arguments.length - 1];
    }
    get Descriptor() {
        return this.descriptor;
    }
    get Command() {
        return this.command;
    }
    get SavedData() {
        return this._savedData;
    }
    set SavedData(data) {
        this._savedData = data;
    }
    get DescriptorPosArgs() {
        return this.descriptor.args.filter(arg => (0, descriptor_helpers_1.isArgumentDescPositional)(arg));
    }
    get DescriptorPairArgs() {
        return this.descriptor.args.filter(arg => (0, descriptor_helpers_1.isArgumentDescPair)(arg));
    }
    get ReadPositionals() {
        return this.arguments
            .filter(arg => arg.position !== undefined)
            .sort((arg1, arg2) => arg1.position - arg2.position);
    }
    get IsDescriptorEmpty() {
        return this.descriptor.args.length === 0;
    }
    get IsDescriptorRequiredEmpty() {
        return this.descriptor.args.filter(arg => arg.required).length === 0;
    }
    get NextPositionalInd() {
        return this.ReadPositionals.length + 1;
    }
    get MaxPositionalInd() {
        return this.DescriptorPosArgs.length;
    }
    ctxOrCurrent(ctx) {
        return ctx ? ctx : this.currentArgCtx;
    }
    isAllArgumentRead_fromDescriptorSlice(descSlice) {
        for (const argDesc of descSlice.args) {
            switch ((0, descriptor_helpers_1.getArgumentDescType)(argDesc)) {
                case 'standalone':
                    if (!this.isArgumentStandaloneRead(argDesc.name)) {
                        return false;
                    }
                    break;
                case 'positional':
                    if (!this.isArgumentPositionalRead(argDesc.position)) {
                        return false;
                    }
                    break;
                case 'pair':
                    if (!this.isArgumentNameRead(argDesc.name)) {
                        return false;
                    }
                    break;
                default:
                    throw new Error(`Invalid argument descriptor type: ${JSON.stringify(argDesc, null, 2)}`);
            }
        }
        return true;
    }
    isEveryArgumentsRead() {
        return this.isAllArgumentRead_fromDescriptorSlice(this.descriptor);
    }
    isRequiredArgumentsRead() {
        const requiredOnly = (0, object_1.deepClone)(this.descriptor);
        requiredOnly.args = requiredOnly.args.filter(arg => arg.required);
        return this.isAllArgumentRead_fromDescriptorSlice(requiredOnly);
    }
    isArgumentNameRead(input, ctx) {
        ctx = this.ctxOrCurrent(ctx);
        const searchArray = this.arguments.filter(arg => arg.ctx === (ctx));
        for (const read of searchArray) {
            if (read.name === input && read.value != '') {
                return true;
            }
            else if (read.name.startsWith('positional-') && read.value != '') {
                const { name } = (0, command_1.decodePositionalName)(read.name);
                if (name === input) {
                    return true;
                }
            }
        }
        return false;
    }
    isArgumentRead(input, ctx) {
        ctx = this.ctxOrCurrent(ctx);
        const searchArray = this.arguments.filter(arg => arg.ctx === (ctx));
        for (const read of searchArray) {
            if (read.name === input) {
                return true;
            }
            else if (read.name.startsWith('positional-') && read.value != '') {
                const { name } = (0, command_1.decodePositionalName)(read.name);
                if (name === input) {
                    return true;
                }
            }
        }
        return false;
    }
    isArgumentStandaloneRead(input, ctx) {
        ctx = this.ctxOrCurrent(ctx);
        return this.arguments.some(arg => arg.name === input && arg.ctx === ctx && arg.standalone === true);
    }
    isArgumentPositionalRead(pos, ctx) {
        ctx = this.ctxOrCurrent(ctx);
        return this.arguments.some(arg => arg.position === pos && arg.ctx === ctx && arg.value != '');
    }
    findDescriptorByName(name, ctx) {
        const inCurrent = this.descriptor.args.find(arg => arg.name === name && arg.ctx === (ctx ?? this.currentArgCtx));
        if (inCurrent)
            return inCurrent;
        if (!ctx) {
            const inAny = this.descriptor.args.find(arg => arg.name === name);
            if (inAny) {
                this.currentArgCtx = inAny.ctx;
            }
            return inAny;
        }
        return undefined;
    }
    findReadArgumentByDescritor(desc) {
        return this.arguments.find(arg => arg.name === desc.name && arg.ctx === desc.ctx);
    }
    isDescriptorExists(name, ctx) {
        return this.findDescriptorByName(name, ctx) !== undefined;
    }
    transitState(to) {
        logger_1.default.trace(`Transiting from ${this.state} to ${to}`);
        if (to === this.state) {
            return;
        }
        if (stateTransiteMap[this.state].includes(to)) {
            this._prevState = this.state;
            this.state = to;
            return;
        }
        throw new Error(`Can't transite from ${this.state} to ${to}. Invalid state transition`);
    }
    parseNextToken(tkn) {
        if (this.chainDirty) {
            this.buildChain();
            this.chainDirty = false;
        }
        this.snap();
        return this.tknParseChain.handle({ tkn });
    }
}
exports.CBParser = CBParser;
