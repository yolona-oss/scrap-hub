import { IUIPlugin } from "@core/ui/types/plugin"
import { TgContext } from "./context"
import { Telegraf } from "telegraf"

export interface ITelegramPlugin extends IUIPlugin<TgContext> {
    /** Inject raw telegraf middleware (runs after auth, before history save) */
    setupMiddleware?(bot: Telegraf<TgContext>): void
    /** Register additional callback action handlers */
    setupActions?(bot: Telegraf<TgContext>): void
    /** Register additional telegraf command handlers */
    setupCommands?(bot: Telegraf<TgContext>): void
}
