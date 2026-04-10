import { BaseUIContext, IvokeableType, IUICommand, IUI } from "@core/ui";
import { CmdDispatcher } from "../dispatcher";
import { CmdArgumentProxy } from "../arg-proxy";

// TODO: create base class to not dot this. ITS CREATED ONLY CAUSE IUICommandinvokable use args fields as parsed
interface IBuiltInCommandType<Ctx extends BaseUIContext = BaseUIContext> extends IUICommand {
    invokable: IvokeableType<Ctx>;
}

export interface BuiltInCommand<UICtx extends BaseUIContext = BaseUIContext> extends IBuiltInCommandType<UICtx> {
    invokable: (this: CmdDispatcher<UICtx>, args: CmdArgumentProxy, ctx: UICtx, uiImpl: IUI<UICtx>) => Promise<void>;
}
