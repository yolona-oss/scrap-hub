"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMMAND_ARG_DESC_KEY = exports.getCmdArgMetadata = exports.CmdArgument = exports.compileArgumentFromDesc = exports.isArgumentDescPair = exports.isArgumentDescPositional = exports.isArgumentDescStandalone = exports.getArgumentDescType = exports.validateArgumentDescriptor = exports.decodePositionalName = exports.encodePositionalName = void 0;
var common_1 = require("@cmd-hub/common");
Object.defineProperty(exports, "encodePositionalName", { enumerable: true, get: function () { return common_1.encodePositionalName; } });
Object.defineProperty(exports, "decodePositionalName", { enumerable: true, get: function () { return common_1.decodePositionalName; } });
Object.defineProperty(exports, "validateArgumentDescriptor", { enumerable: true, get: function () { return common_1.validateArgumentDescriptor; } });
Object.defineProperty(exports, "getArgumentDescType", { enumerable: true, get: function () { return common_1.getArgumentDescType; } });
Object.defineProperty(exports, "isArgumentDescStandalone", { enumerable: true, get: function () { return common_1.isArgumentDescStandalone; } });
Object.defineProperty(exports, "isArgumentDescPositional", { enumerable: true, get: function () { return common_1.isArgumentDescPositional; } });
Object.defineProperty(exports, "isArgumentDescPair", { enumerable: true, get: function () { return common_1.isArgumentDescPair; } });
Object.defineProperty(exports, "compileArgumentFromDesc", { enumerable: true, get: function () { return common_1.compileArgumentFromDesc; } });
Object.defineProperty(exports, "CmdArgument", { enumerable: true, get: function () { return common_1.CmdArgument; } });
Object.defineProperty(exports, "getCmdArgMetadata", { enumerable: true, get: function () { return common_1.getCmdArgMetadata; } });
Object.defineProperty(exports, "COMMAND_ARG_DESC_KEY", { enumerable: true, get: function () { return common_1.COMMAND_ARG_DESC_KEY; } });
__exportStar(require("./option"), exports);
