import { CmdDispatcher, ManagerControlPlugin } from '@cmd-hub/core'
import { CLIUI, type CLIContext } from '@cmd-hub/ui-cli'
import type { UiFactory } from './types'

/** CLI UI factory. The CLI's constructor wants the dispatcher up-front
 *  (its tab-completer reads from it on every keystroke), so we mint a
 *  fresh one here and let the framework attach transport / repos to it
 *  via `ui.dispatcher`. */
export const uiFactory: UiFactory = () => {
    const dispatcher = new CmdDispatcher<CLIContext>()
    return new CLIUI(dispatcher).use(new ManagerControlPlugin())
}
