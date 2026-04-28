import { ManagerControlPlugin } from '@cmd-hub/core'
import { TelegramUI } from '@cmd-hub/ui-telegram'
import type { UiFactory } from './types'

/** Telegram UI factory. The UI self-creates its dispatcher inside
 *  `onAppAttach`; the framework then attaches transport, repos, and
 *  the manifest aggregator to that dispatcher. */
export const uiFactory: UiFactory = () => new TelegramUI().use(new ManagerControlPlugin())
