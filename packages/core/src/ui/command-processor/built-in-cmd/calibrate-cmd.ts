import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { UiUnicodeSymbols } from "../../../ui"
import { IMarkupButton } from "../types/markup"
import type { IManagerRepo } from "@cmd-hub/common"

const CALIBRATE_WIDTHS = [30, 35, 40, 45, 48, 52, 56, 60, 64, 68, 72]
const CALIBRATE_CB_PREFIX = "calibrate_"

export { CALIBRATE_CB_PREFIX, CALIBRATE_WIDTHS }

/**
 * Persist a width selection from the calibration callback. UIs invoke this
 * from their callback handler with the live `IManagerRepo` (read off the
 * dispatcher's repos bag).
 */
export async function handleCalibrationCallback(
    managerRepo: IManagerRepo,
    userId: string | number,
    width: number,
): Promise<string> {
    const manager = await managerRepo.findByUserId(userId)
    if (!manager) {
        return `${UiUnicodeSymbols.error} Manager not found`
    }
    await managerRepo.updateById(manager.id, { messageWidth: width })
    return `${UiUnicodeSymbols.success} Message width set to ${width} characters`
}

export const CalibrateCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.CALIBRATE,
    description: "Calibrate message display width for your screen",
    invokable: async function(this: CmdDispatcher<any>, _args: CmdArgumentProxy, ctx, uiImpl) {
        let text = `${UiUnicodeSymbols.magnifierGlass} Tap the longest line that fits without wrapping:\n\n`
        for (const w of CALIBRATE_WIDTHS) {
            const label = `[${w}] `
            const fill = '#'.repeat(w - label.length)
            text += `${label}${fill}\n`
        }

        const buttons: IMarkupButton[] = CALIBRATE_WIDTHS.map(w => ({
            text: `${w}`,
            type: "value" as const,
            data: `${CALIBRATE_CB_PREFIX}${w}`,
        }))

        await uiImpl.sendMessage(String(ctx.manager.userId), text, buttons)
    }
}
