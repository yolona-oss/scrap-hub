export type { AvailableUIsType } from '@cmd-hub/common'

export const enum AvailableUIsEnum {
    Telegram = "telegram",
    CLI = "cli",
    Web = "web",
}
export { TelegramUI, type TgContext } from './telegram'
export { CLIUI, type CLIContext } from './cli'
export { WebUI, type WebContext, InvitationLink } from './web'

// Register built-in UIs
import { UIRegistry } from '../registry'
import { TelegramUI } from './telegram'
import { CLIUI } from './cli'
import { WebUI } from './web'

UIRegistry.register("telegram", (dispatcher: any, opts: any) => new TelegramUI(opts.token, dispatcher))
UIRegistry.register("cli", (dispatcher: any) => new CLIUI(dispatcher))
UIRegistry.register("web", (dispatcher: any, opts: any) => new WebUI(opts.port ?? 3000, dispatcher))
