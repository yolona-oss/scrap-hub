"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Chain = void 0;
exports.chainHandlerFactory = chainHandlerFactory;
exports.createChainFallbackHandler = createChainFallbackHandler;
class Chain {
    handlers = [];
    fallThrowRes = {};
    get Handlers() {
        return this.handlers;
    }
    use(handler) {
        if (this.handlers.length > 0) {
            this.handlers[this.handlers.length - 1].setNext(handler);
        }
        this.handlers.push(handler);
    }
    useFirst(handler) {
        if (this.handlers.length > 0) {
            handler.setNext(this.handlers[0]);
        }
        this.handlers.unshift(handler);
    }
    useMany(handlers) {
        handlers.forEach(handler => this.use(handler));
    }
    drop() {
    }
    setFallThrowResponse(res) {
        this.fallThrowRes = res;
    }
    handle(request) {
        if (this.handlers.length > 0) {
            return this.handlers[0].handle(request);
        }
        return this.fallThrowRes;
    }
}
exports.Chain = Chain;
function chainHandlerFactory(handler, thisArg) {
    let next = null;
    return {
        setNext(handler) {
            next = handler;
            return next;
        },
        handle(request) {
            const handled = handler.call(thisArg, request);
            if (handled !== undefined) {
                return handled;
            }
            if (next) {
                return next.handle(request);
            }
            return undefined;
        }
    };
}
function createChainFallbackHandler(fallbackValue) {
    return chainHandlerFactory(function () {
        return fallbackValue;
    });
}
