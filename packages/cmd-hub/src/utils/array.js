"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.intersect = intersect;
exports.difference = difference;
exports.union = union;
exports.unique = unique;
exports.isUnique = isUnique;
exports.isEqual_JsonSort = isEqual_JsonSort;
exports.isEqual_Simple = isEqual_Simple;
exports.isEqual_Deep = isEqual_Deep;
exports.isContainsAll = isContainsAll;
exports.shuffle = shuffle;
exports.removeObjectByFieldsMutate = removeObjectByFieldsMutate;
const object_1 = require("./object");
function intersect(a, b) {
    return a.filter(x => b.includes(x));
}
function difference(a, b) {
    return a.filter(x => !b.includes(x));
}
function union(a, b) {
    return [...a, ...b];
}
function unique(a) {
    return [...new Set(a)];
}
function isUnique(a) {
    return a.length === unique(a).length;
}
function isEqual_JsonSort(a, b) {
    return JSON.stringify(a.sort()) === JSON.stringify(b.sort());
}
function isEqual_Simple(arr1, arr2) {
    return arr1.length === arr2.length &&
        arr1.every((value, index) => value === arr2[index]);
}
function isEqual_Deep(arr1, arr2) {
    if (arr1.length !== arr2.length)
        return false;
    for (let i = 0; i < arr1.length; i++) {
        if (typeof arr1[i] === 'object' && typeof arr2[i] === 'object') {
            if (!(0, object_1.isObjectsEqual)(arr1[i], arr2[i]))
                return false;
        }
        else if (arr1[i] !== arr2[i]) {
            return false;
        }
    }
    return true;
}
function isContainsAll(base, overlap) {
    return overlap.every(val => base.includes(val));
}
function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}
;
function removeObjectByFieldsMutate(arr, criteria) {
    for (let i = arr.length - 1; i >= 0; i--) {
        let match = true;
        for (const key in criteria) {
            if (criteria.hasOwnProperty(key) && arr[i][key] !== criteria[key]) {
                match = false;
                break;
            }
        }
        if (match) {
            arr.splice(i, 1);
        }
    }
}
