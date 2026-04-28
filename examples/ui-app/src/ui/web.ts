import { CmdDispatcher, ManagerControlPlugin } from '@cmd-hub/core'
import { WebUI, type WebContext } from '@cmd-hub/ui-web'
import type { UiFactory } from './types'

/** Web UI factory. Reads the listen port from `process.env.WEB_PORT`
 *  (default 8080) so the same binary can be deployed against any
 *  environment-specified port without a code change. */
export const uiFactory: UiFactory = () => {
    const port = Number(process.env.WEB_PORT ?? 8080)
    const dispatcher = new CmdDispatcher<WebContext>()
    return new WebUI(port, dispatcher).use(new ManagerControlPlugin())
}
