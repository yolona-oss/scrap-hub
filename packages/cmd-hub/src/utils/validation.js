"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidConfigPath = isValidConfigPath;
function isValidConfigPath(path) {
    return /^[a-zA-Z0-9_.]+$/.test(path)
        && !path.startsWith('$')
        && !path.includes('__proto__')
        && !path.includes('constructor')
        && !path.includes('prototype');
}
