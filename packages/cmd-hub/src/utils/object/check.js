"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmpty = isEmpty;
exports.isObject = isObject;
exports.isObjectsEqual = isObjectsEqual;
function isEmpty(obj) {
    return Object.keys(obj).length === 0;
}
function isObject(obj) {
    return obj !== null && typeof obj === 'object' && !Array.isArray(obj);
}
function isObjectsEqual(obj1, obj2) {
    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);
    if (keys1.length !== keys2.length)
        return false;
    for (const key of keys1) {
        if (obj1[key] !== obj2[key])
            return false;
    }
    return true;
}
