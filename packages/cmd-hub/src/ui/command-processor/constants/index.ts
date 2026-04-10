import { asId } from "@core/types/identificable"
import {
    BuiltInAccountCommandsEnum,
    BuiltInHelpCommandsEnum,
    BuiltInSeqCommandsEnum,
    BuiltInServiceCommandsEnum,
    BuiltInAliasCommandsEnum
} from "./built-in-cmd-enum"

export const BLANK_USER_ID = asId("__pussy_killer__")
export const CLI_USER_NAME = asId("__gandonio__")
export const CLI_USER_ID = -100500

export const BuiltInCmdNames = [
    ...Object.values(BuiltInSeqCommandsEnum),
    ...Object.values(BuiltInServiceCommandsEnum),
    ...Object.values(BuiltInAccountCommandsEnum),
    ...Object.values(BuiltInHelpCommandsEnum),
    ...Object.values(BuiltInAliasCommandsEnum),
]

export * from './built-in-cmd-enum'
