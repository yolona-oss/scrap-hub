import { CmdDispatcher } from "@core/ui/command-processor"
import { IRunnable } from "@core/types/runnable"
import { WithInit } from "@core/types/with-init"
import { BaseUIContext } from "./context"
import { LockManager } from "@utils/lock-manager"
import { AvailableUIsType } from "./../impls"
import { IMarkupOption } from "../command-processor/types/markup"

export interface MessageOptions {
    parseMode?: 'HTML' | 'MarkdownV2'
}

export interface IUI<CtxType extends BaseUIContext> extends IRunnable, WithInit {
    readonly dispatcher: CmdDispatcher<CtxType>

    /**
    * @returns message_id of sent message
    */
    sendMessage(user_id: string, message: string, markup?: IMarkupOption[], options?: MessageOptions): Promise<string>
    editMessage(user_id: string, message_id: string, message?: string, markup?: IMarkupOption[], options?: MessageOptions): Promise<void>
    deleteMessage(user_id: string, message_id: string): Promise<void>

    max_message_width(): number

    ContextType(): AvailableUIsType
    
    consolePrintCommands(): void

    lock(lockManager: LockManager): boolean
    unlock(lockManager: LockManager): boolean

    terminate(): Promise<void>
}
