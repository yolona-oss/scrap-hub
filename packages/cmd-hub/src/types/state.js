"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AbstractCtx = exports.AbstractState = void 0;
class AbstractState {
    context;
    setContext(context) {
        this.context = context;
    }
}
exports.AbstractState = AbstractState;
class AbstractCtx {
    _ctx_state;
    get CurrentCtxStateObj() {
        return this._ctx_state;
    }
    constructor(initialState) {
        this.transitionTo(initialState);
    }
    transitionTo(state) {
        this._ctx_state = state;
        this._ctx_state.setContext(this);
    }
}
exports.AbstractCtx = AbstractCtx;
