"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseUI = void 0;
const common_1 = require("@cmd-hub/common");
const message_lifecycle_1 = require("./message-lifecycle");
class BaseUI extends common_1.BaseUI {
    lifecycle = new message_lifecycle_1.MessageLifecycleManager(this);
}
exports.BaseUI = BaseUI;
