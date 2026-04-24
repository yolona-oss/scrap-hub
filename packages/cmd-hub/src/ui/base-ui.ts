import { BaseUI as CommonBaseUI } from '@cmd-hub/common'
import type { BaseUIContext } from '@cmd-hub/common'
import { CmdDispatcher } from './command-processor'
import { MessageLifecycleManager } from './message-lifecycle'
import type { IUI } from './types/ui'

/**
 * Cmd-hub's BaseUI is the common BaseUI narrowed to the concrete
 * `CmdDispatcher<Ctx>` dispatcher type plus a `.lifecycle` field backed by the
 * mongoose-backed `MessageLifecycleManager`. Keeping the lifecycle here (rather
 * than in @cmd-hub/common) preserves the framework/data-layer boundary.
 */
export abstract class BaseUI<CtxType extends BaseUIContext> extends CommonBaseUI<CtxType, CmdDispatcher<CtxType>> {
    public readonly lifecycle: MessageLifecycleManager<CtxType> =
        new MessageLifecycleManager(this as unknown as IUI<CtxType>)
}
