import type { CmdDispatcher } from "../../ui/command-processor"
import type { BaseUIContext, IUI as CommonIUI, MessageOptions } from '@cmd-hub/common'

// Re-export what the rest of cmd-hub imports.
export type { MessageOptions }
export type IUI<CtxType extends BaseUIContext> = CommonIUI<CtxType, CmdDispatcher<CtxType>>
