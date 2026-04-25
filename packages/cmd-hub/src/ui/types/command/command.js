"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isFunc = isFunc;
exports.isService = isService;
function isFunc(mixin) {
    return typeof mixin === "function";
}
function isService(mixin) {
    return !isFunc(mixin);
}
