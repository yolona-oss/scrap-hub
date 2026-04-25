"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOptionSetterString = exports.isOptionSetterFunc = void 0;
exports.exposeCmdArgumentOptions = exposeCmdArgumentOptions;
const common_1 = require("@cmd-hub/common");
Object.defineProperty(exports, "isOptionSetterString", { enumerable: true, get: function () { return common_1.isOptionSetterString; } });
exports.isOptionSetterFunc = common_1.isOptionSetterFunc;
async function exposeCmdArgumentOptions(cmdName, options, dispatcher, manager) {
    if (options instanceof Function) {
        return await options(cmdName, dispatcher, manager);
    }
    else if (Array.isArray(options)) {
        return options;
    }
    else {
        return undefined;
    }
}
