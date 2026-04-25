"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractValueFromObject = extractValueFromObject;
exports.assignToCustomPath = assignToCustomPath;
exports.removeFieldFromObject = removeFieldFromObject;
function extractValueFromObject(obj, path) {
    const keys = path.split('.');
    let current = obj;
    for (const key of keys) {
        if (current && typeof current === 'object') {
            if (Array.isArray(current) && /^\d+$/.test(key)) {
                const index = parseInt(key, 10);
                if (index >= 0 && index < current.length) {
                    current = current[index];
                }
                else {
                    throw new Error(`Invalid array index: ${index}`);
                }
            }
            else if (key in current) {
                current = current[key];
            }
            else {
                throw new Error(`Invalid path: ${path}`);
            }
        }
        else {
            throw new Error(`Invalid path: ${path}`);
        }
    }
    return current;
}
function assignToCustomPath(obj, path, value) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }
    const finalKey = keys[keys.length - 1];
    current[finalKey] = value;
    return obj;
}
function removeFieldFromObject(obj, path) {
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (current && typeof current === 'object') {
            if (Array.isArray(current) && /^\d+$/.test(key)) {
                const index = parseInt(key, 10);
                if (index >= 0 && index < current.length) {
                    current = current[index];
                }
                else {
                    throw new Error(`Invalid array index: ${index}`);
                }
            }
            else if (key in current) {
                current = current[key];
            }
            else {
                throw new Error(`Invalid path: ${path}`);
            }
        }
        else {
            throw new Error(`Invalid path: ${path}`);
        }
    }
    const finalKey = keys[keys.length - 1];
    if (current && typeof current === 'object' && finalKey in current) {
        if (Array.isArray(current)) {
            throw new Error(`Cannot remove array element by index: ${finalKey.toString()}`);
        }
        else {
            delete current[finalKey];
        }
    }
    else {
        throw new Error(`Invalid path: ${path}`);
    }
    return obj;
}
