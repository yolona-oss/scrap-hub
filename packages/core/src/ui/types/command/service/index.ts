// Service-layer exports are re-exported from @cmd-hub/common, but explicitly
// — a wildcard re-export would collide with the ui/ types (IUI, IUIPlugin, etc).
export type { IntercomAction } from '@cmd-hub/common'
export { BaseCommandService } from '@cmd-hub/common'
export {
    CmdServiceData,
    GlobalServiceArgs,
    GlobalServiceIntercom,
} from '@cmd-hub/common'
export type { ServiceContext } from '@cmd-hub/common'
export { BLANK_SERVICE_NAME } from '@cmd-hub/common'
export type {
    IServiceStore,
    IServiceAccountLayer,
    IServiceSessionLayer,
    IServiceStoreLoadResult,
} from '@cmd-hub/common'
export { DEFAULT_ACCOUNT_SESSION_NAME, DEFAULT_SESSION_EXPIRITY_MS } from '@cmd-hub/common'
// utils helpers stay local; keep importing them directly where needed.
