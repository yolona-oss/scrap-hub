"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getInterfacePaths = getInterfacePaths;
exports.getInterfacePathsWithTypes = getInterfacePathsWithTypes;
function getInterfacePaths(obj) {
    const paths = [];
    function traverse(currentObj, currentPath = "") {
        for (const key in currentObj) {
            if (typeof currentObj[key] === "object" && currentObj[key] !== null) {
                traverse(currentObj[key], `${currentPath}${key}.`);
            }
            else {
                paths.push(`${currentPath}${key}`);
            }
        }
    }
    traverse(obj);
    return paths;
}
function getInterfacePathsWithTypes(obj) {
    const result = [];
    function traverse(currentObj, currentPath = "") {
        for (const key in currentObj) {
            const fullPath = currentPath ? `${currentPath}.${key}` : key;
            if (typeof currentObj[key] === "object" && currentObj[key] !== null) {
                traverse(currentObj[key], fullPath);
            }
            else {
                result.push({ path: fullPath, type: (typeof currentObj[key]).toLowerCase() });
            }
        }
    }
    traverse(obj);
    return result;
}
