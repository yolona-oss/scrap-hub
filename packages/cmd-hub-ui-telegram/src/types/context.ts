import type { ManagerRecord } from '@cmd-hub/common'
import { BaseUIContext } from '@cmd-hub/core'

import { NarrowedContext, Context, Types } from "telegraf"
import { CallbackQuery, Update } from "telegraf/typings/core/types/typegram"

export interface TgContext extends NarrowedContext<Context, Update>, BaseUIContext<ManagerRecord> {
    type: 'telegram'

    manager: ManagerRecord
    text: string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reply: (...args: any[]) => Promise<any>
}

type CqContextV1 = NarrowedContext<
        TgContext & { match: RegExpExecArray; },
        Types.MountMap['callback_query']
    >

export type CqContext = CqContextV1
