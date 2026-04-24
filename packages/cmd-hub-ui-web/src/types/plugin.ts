import { IUIPlugin } from '@cmd-hub/core'
import { WebContext } from "./context"

export interface IWebUIPlugin extends IUIPlugin<WebContext> {
    setupRoutes?(app: import('express').Express): void
}
