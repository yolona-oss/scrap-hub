import type { BaseUIContext, IUIPlugin as CommonIUIPlugin } from '@cmd-hub/common'
import type { AbstractCmdHandler } from '../command-processor/handlers/abstract-handler'

export type IUIPlugin<CtxType extends BaseUIContext = BaseUIContext> =
    CommonIUIPlugin<CtxType, AbstractCmdHandler<CtxType>>
