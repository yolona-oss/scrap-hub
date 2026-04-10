import { IManager } from "@core/db";
import { BaseUIContext } from "@core/ui/types";
import { AvailableUIsEnum } from "../..";

import { NarrowedContext, Context, Types } from "telegraf";
import { CallbackQuery, Update } from "telegraf/typings/core/types/typegram";

export interface TgContext extends NarrowedContext<Context, Update>, BaseUIContext {
    type: AvailableUIsEnum.Telegram

    manager: IManager
    text: string
    reply: (...args: any[]) => Promise<any>
}

type CqContextV1 = NarrowedContext<
        TgContext & { match: RegExpExecArray; },
        Types.MountMap['callback_query']
    >;

type CqContextV2 = Context<Update.CallbackQueryUpdate<CallbackQuery>> & Omit<TgContext, keyof Context<Update>>

export type CqContext = CqContextV1
