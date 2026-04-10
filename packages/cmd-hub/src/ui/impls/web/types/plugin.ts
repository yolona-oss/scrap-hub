import { IUIPlugin } from "@core/ui/types/plugin"
import { WebContext } from "./context"

export interface IWebUIPlugin extends IUIPlugin<WebContext> {
    setupRoutes?(app: import('express').Express): void
}
