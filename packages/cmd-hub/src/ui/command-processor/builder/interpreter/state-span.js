"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StateSnaper = exports.StateSnap = void 0;
const stack_1 = require("../../../../utils/struct/stack");
class StateSnap {
    currentCtx;
    state;
    _prevState;
    waitNextBuf;
    args;
    constructor(currentCtx, state, _prevState, waitNextBuf, args) {
        this.currentCtx = currentCtx;
        this.state = state;
        this._prevState = _prevState;
        this.waitNextBuf = waitNextBuf;
        this.args = args;
    }
}
exports.StateSnap = StateSnap;
class StateSnaper {
    maxSnaps;
    batchClean;
    snaps;
    constructor(maxSnaps = 15, batchClean = 5) {
        this.maxSnaps = maxSnaps;
        this.batchClean = batchClean;
        this.snaps = new stack_1.Stack(maxSnaps);
        if (batchClean > maxSnaps) {
            throw new Error(`StateSnaper:: BatchClean must be less than maxSnaps`);
        }
    }
    memorize(snap) {
        this.snaps.push(snap);
        if (this.snaps.size() > this.maxSnaps) {
            this.snaps.pop(this.batchClean);
        }
    }
    get back() {
        return this.snaps.pop(2);
    }
    get latest() {
        return this.snaps.peek();
    }
}
exports.StateSnaper = StateSnaper;
