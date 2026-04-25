import type { ManagerRecord } from '@cmd-hub/common'
import { BaseUIContext } from '@cmd-hub/common'

export interface WebContext extends BaseUIContext<ManagerRecord> {
    type: "web"
    manager: ManagerRecord
    text: string
    socketId: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reply(message: string, extra?: any): Promise<any>
}
