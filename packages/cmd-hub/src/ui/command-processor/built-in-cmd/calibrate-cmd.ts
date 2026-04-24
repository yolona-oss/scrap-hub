import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { Manager } from "../../../db"
import { UiUnicodeSymbols } from "../../../ui"
import { IMarkupButton } from "../types/markup"

const CALIBRATE_WIDTHS = [30, 35, 40, 45, 48, 52, 56, 60, 64, 68, 72]
const CALIBRATE_CB_PREFIX = "calibrate_"

export { CALIBRATE_CB_PREFIX, CALIBRATE_WIDTHS }

export async function handleCalibrationCallback(userId: string | number, width: number): Promise<string> {
    const manager = await Manager.findOne({ userId })
    if (!manager) {
        return `${UiUnicodeSymbols.error} Manager not found`
    }
    manager.messageWidth = width
    await manager.save()
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
