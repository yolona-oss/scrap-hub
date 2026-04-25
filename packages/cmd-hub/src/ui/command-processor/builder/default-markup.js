"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuilderMarkups = void 0;
const default_callbacks_1 = require("./default-callbacks");
const Buttons = {
    execute: {
        text: "Execute",
        type: "aux",
        data: default_callbacks_1.BuilderActionSigns.execute
    },
    cancelBuild: {
        text: "Cancel",
        type: "aux",
        data: default_callbacks_1.BuilderActionSigns.cancelBuild
    },
    cancelOp: {
        text: "Cancel operation",
        type: "aux",
        data: default_callbacks_1.BuilderActionSigns.cancelOp
    },
    changeCtx: {
        text: "Select reading context",
        type: "aux",
        data: default_callbacks_1.BuilderActionSigns.switchCtx
    },
};
exports.BuilderMarkups = {
    default: [
        Buttons.execute,
        Buttons.cancelBuild,
        Buttons.changeCtx
    ],
    selection: [
        Buttons.cancelOp
    ]
};
