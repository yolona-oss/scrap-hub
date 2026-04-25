"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateWithNeighborsMap = validateWithNeighborsMap;
function validateWithNeighborsMap(map) {
    for (const [key, value] of map.entries()) {
        if (value.prev !== undefined && !map.has(value.prev)) {
            console.error(`Invalid 'prev' value: ${value.prev} for key: ${key}`);
            return false;
        }
        if (value.next !== undefined) {
            for (const nextKey of value.next) {
                if (!map.has(nextKey)) {
                    console.error(`Invalid 'next' value: ${nextKey} for key: ${key}`);
                    return false;
                }
            }
        }
    }
    return true;
}
