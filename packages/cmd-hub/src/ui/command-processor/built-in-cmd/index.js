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
exports.BuiltInCommandNames = void 0;
exports.toRegister = toRegister;
__exportStar(require("./account-ctrl-cmd"), exports);
__exportStar(require("./service-ctrl-cmd"), exports);
__exportStar(require("./help-cmd"), exports);
__exportStar(require("./sequence-cmd"), exports);
__exportStar(require("./cmd-alias-ctlr"), exports);
__exportStar(require("./calibrate-cmd"), exports);
__exportStar(require("./dashboard-panel"), exports);
__exportStar(require("./sconfig-cmd"), exports);
__exportStar(require("./config-cmd"), exports);
__exportStar(require("./sinfo-cmd"), exports);
__exportStar(require("./invite-cmd"), exports);
const constants_1 = require("../constants");
exports.BuiltInCommandNames = Object.values(constants_1.BuiltInSeqCommandsEnum)
    .concat(Object.values(constants_1.BuiltInHelpCommandsEnum))
    .concat(Object.values(constants_1.BuiltInAccountCommandsEnum))
    .concat(Object.values(constants_1.BuiltInServiceCommandsEnum))
    .concat(Object.values(constants_1.BuiltInAliasCommandsEnum))
    .concat(Object.values(constants_1.BuiltInUiCommandsEnum));
function toRegister(cmd, dispatcher) {
    return {
        command: {
            command: cmd.command,
            description: cmd.description,
            args: cmd.args,
            next: cmd.next,
            prev: cmd.prev
        },
        invokable: cmd.invokable.bind(dispatcher),
        requires: cmd.requires,
    };
}
