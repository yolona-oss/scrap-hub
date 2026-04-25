"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deepMerge = deepMerge;
const check_1 = require("./check");
function deepMerge(target, source, visited = new Map()) {
    if ((0, check_1.isObject)(target) && (0, check_1.isObject)(source)) {
        for (const key in source) {
            if ((0, check_1.isObject)(source[key])) {
                if (!target[key]) {
                    target[key] = {};
                }
                if (!visited.has(source[key])) {
                    visited.set(source[key], {});
                    deepMerge(target[key], source[key], visited);
                }
                else {
                    target[key] = visited.get(source[key]);
                }
            }
            else {
                target[key] = source[key];
            }
        }
    }
    return target;
}
