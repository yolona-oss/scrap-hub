import { IManager } from "@core/db"
import { BaseUIContext } from "@core/ui"

export interface WebContext extends BaseUIContext<IManager & { userId: number | string }> {
    type: "web"
    manager: IManager & { userId: number | string }
    text: string
    socketId: string
    reply(message: string, extra?: any): Promise<any>
}
