"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuilderActionSigns = void 0;
exports.isBuilderActionSign = isBuilderActionSign;
const identificable_1 = require("../../../types/identificable");
exports.BuilderActionSigns = {
    execute: (0, identificable_1.genRandId)(),
    cancelBuild: (0, identificable_1.genRandId)(),
    switchCtx: (0, identificable_1.genRandId)(),
    cancelOp: (0, identificable_1.genRandId)(),
    changeInterpritationMode: (0, identificable_1.genRandId)()
};
function isBuilderActionSign(input) {
    return Object.values(exports.BuilderActionSigns).includes(input);
}
