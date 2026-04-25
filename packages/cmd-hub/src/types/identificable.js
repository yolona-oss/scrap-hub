"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asId = asId;
exports.genRandId = genRandId;
exports.isIdentifiable = isIdentifiable;
function validateId(id) {
    return /^[a-z0-9_-]+$/.test(id);
}
function transformToValidId(id) {
    if (validateId(id)) {
        return id;
    }
    const copy = id;
    copy.replace(/[^a-z0-9_-]+/gi, '').toLowerCase();
    if (copy.length === 0) {
        throw new Error(`Cannot transform ${id} to a valid ID`);
    }
    return copy;
}
function asId(id) {
    return transformToValidId(id);
}
let idCounter = 0;
function genIncremId() {
    return `incremental_id_${idCounter++}`;
}
function genRandId() {
    return crypto.randomUUID();
}
function isIdentifiable(obj) {
    if (typeof obj !== 'object' || obj === null || !('id' in obj)) {
        return false;
    }
    if (typeof obj.id === 'string') {
        return validateId(obj.id);
    }
    if (typeof obj.id === 'number') {
        return true;
    }
    return false;
}
