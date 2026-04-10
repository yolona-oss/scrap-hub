import { IMarkupButton } from "../types/markup"
import { BuilderActionSigns } from "./default-callbacks"

export type BuilderMarkupsTypes = 'default' | 'selection'
export type ButtonType = 'execute' | 'cancelBuild' | 'cancelOp' | 'changeCtx'

const Buttons: Record<ButtonType, IMarkupButton> = {
    execute: {
        text: "Execute",
        type: "aux",
        data: BuilderActionSigns.execute
    },

    cancelBuild: {
        text: "Cancel",
        type: "aux",
        data: BuilderActionSigns.cancelBuild
    },

    cancelOp: {
        text: "Cancel operation",
        type: "aux",
        data: BuilderActionSigns.cancelOp
    },

    changeCtx: {
        text: "Select reading context",
        type: "aux",
        data: BuilderActionSigns.switchCtx
    },
}

export const BuilderMarkups: Record<BuilderMarkupsTypes, Array<IMarkupButton>> = {
    default: [
        Buttons.execute,
        Buttons.cancelBuild,
        Buttons.changeCtx
    ],

    selection: [
        Buttons.cancelOp
    ]
}
