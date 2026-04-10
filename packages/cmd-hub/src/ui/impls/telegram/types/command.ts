import { BaseUIContext, IUICommand } from "@core/ui/types";

import { TgContext } from "./context";
import { TelegramUI } from "../telegram-ui";

import { NarrowedContext, Types } from "telegraf";
import { CmdArgumentProxy } from "@core/ui/command-processor/arg-proxy";

export type TextContext = NarrowedContext<TgContext, Types.MountMap['text']>;

// SAME ICSUE AS WITH BUILT-IN-COMMAND
export interface TgCommand<Ctx extends BaseUIContext = BaseUIContext> extends IUICommand {
    invokable: (this: TelegramUI, args: CmdArgumentProxy, ctx: Ctx) => Promise<void>;
}
