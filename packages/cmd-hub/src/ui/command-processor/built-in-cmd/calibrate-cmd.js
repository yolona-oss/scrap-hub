"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CalibrateCommand = exports.CALIBRATE_WIDTHS = exports.CALIBRATE_CB_PREFIX = void 0;
exports.handleCalibrationCallback = handleCalibrationCallback;
const constants_1 = require("../constants");
const ui_1 = require("../../../ui");
const CALIBRATE_WIDTHS = [30, 35, 40, 45, 48, 52, 56, 60, 64, 68, 72];
exports.CALIBRATE_WIDTHS = CALIBRATE_WIDTHS;
const CALIBRATE_CB_PREFIX = "calibrate_";
exports.CALIBRATE_CB_PREFIX = CALIBRATE_CB_PREFIX;
async function handleCalibrationCallback(managerRepo, userId, width) {
    const manager = await managerRepo.findByUserId(userId);
    if (!manager) {
        return `${ui_1.UiUnicodeSymbols.error} Manager not found`;
    }
    await managerRepo.updateById(manager.id, { messageWidth: width });
    return `${ui_1.UiUnicodeSymbols.success} Message width set to ${width} characters`;
}
exports.CalibrateCommand = {
    command: constants_1.BuiltInUiCommandsEnum.CALIBRATE,
    description: "Calibrate message display width for your screen",
    invokable: async function (_args, ctx, uiImpl) {
        let text = `${ui_1.UiUnicodeSymbols.magnifierGlass} Tap the longest line that fits without wrapping:\n\n`;
        for (const w of CALIBRATE_WIDTHS) {
            const label = `[${w}] `;
            const fill = '#'.repeat(w - label.length);
            text += `${label}${fill}\n`;
        }
        const buttons = CALIBRATE_WIDTHS.map(w => ({
            text: `${w}`,
            type: "value",
            data: `${CALIBRATE_CB_PREFIX}${w}`,
        }));
        await uiImpl.sendMessage(String(ctx.manager.userId), text, buttons);
    }
};
