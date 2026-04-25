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
exports.BuiltInCmdNames = exports.CLI_USER_ID = exports.CLI_USER_NAME = exports.BLANK_USER_ID = void 0;
const identificable_1 = require("../../../types/identificable");
const built_in_cmd_enum_1 = require("./built-in-cmd-enum");
exports.BLANK_USER_ID = (0, identificable_1.asId)("__pussy_killer__");
exports.CLI_USER_NAME = (0, identificable_1.asId)("__gandonio__");
exports.CLI_USER_ID = -100500;
exports.BuiltInCmdNames = [
    ...Object.values(built_in_cmd_enum_1.BuiltInSeqCommandsEnum),
    ...Object.values(built_in_cmd_enum_1.BuiltInServiceCommandsEnum),
    ...Object.values(built_in_cmd_enum_1.BuiltInAccountCommandsEnum),
    ...Object.values(built_in_cmd_enum_1.BuiltInHelpCommandsEnum),
    ...Object.values(built_in_cmd_enum_1.BuiltInAliasCommandsEnum),
];
__exportStar(require("./built-in-cmd-enum"), exports);
