// @cmd-hub/core — hub runtime.
//
// Each package owns its public surface; we do NOT re-export siblings
// (ui-telegram / ui-cli / ui-web / transport / node) through here.

// Application lifecycle
export { CmdHubApp } from './cmdhub'
export type { IUIWithAttach, UIFederationRequires } from './cmdhub'
export { Application } from './application'

// Middlewares
export { GrpcServerMiddleware } from './middleware/grpc-server-middleware'
export type { GrpcServerMiddlewareOptions } from './middleware/grpc-server-middleware'
export { CmdNodeClientMiddleware } from './middleware/cmd-node-client-middleware'
export { ConfigBootMiddleware } from './middleware/config-boot-middleware'
export { FederationCapsMiddleware } from './middleware/federation-caps-middleware'
export type { FederationCapsMiddlewareOptions } from './middleware/federation-caps-middleware'

// Remote invoker
export { RemoteCmdInvoker, protoToDashboardEvent } from './ui/command-processor/remote-invoker'
export type { RemoteInvokeInput, RemoteInvokeResult, DashboardFactory, DashboardSession } from './ui/command-processor/remote-invoker'

// Capabilities
export * from './capabilities'

// Dashboard
export type { DashboardEvent, DashboardOptions } from './ui/command-processor/dashboard'

// Command system
export * from './ui/command-processor'
export { AbstractCmdHandler } from './ui/command-processor/handlers/abstract-handler'
export { CBDescriptorCompiler } from './ui/command-processor/builder/desc-compiler'

// UI abstractions (shared with UI impl packages)
export { BaseUI } from './ui/base-ui'
export { BaseUIContext } from './ui/types/context'
export type { IUI, MessageOptions } from './ui/types/ui'
export type { IUIPlugin } from './ui/types/plugin'
export { CmdArgumentProxy } from './ui/command-processor/arg-proxy'
export type { IBaseMarkup, IMarkupOption, IMarkupButton, IMarkupInfoType } from './ui/command-processor/types/markup'
export { LockManager } from './utils/lock-manager'
export { CommandPublisher, TELEGRAM_COMMAND_CONSTRAINTS } from './ui/command-publisher'
export type { CommandPublishConstraints } from './ui/command-publisher'
export { HistoryRecorder } from './ui/history-recorder'
export { ManagerControlPlugin } from './plugins/manager-control'

// Command types & decorators
export * from './ui/types/command'
export {
    BaseCommandService,
    CmdServiceData,
    GlobalServiceConfig,
    GlobalServiceParam,
    GlobalServiceMessages,
} from './ui/types/command/service'
export type { ServiceContext } from './ui/types/command/service'
export { HubGlobalServiceParam } from './ui/types/command/service/hub-service-data'
export {
    sessionOpts,
    sessionOptsWithRand,
    sessionIdValidator,
} from './ui/types/command/service/utils/session-id-generator'

// NOTE: All entity models (Manager, Account, AccountModule, AccountSession,
// MsgHistory, CmdAlias, PendingDelete, InvitationLink, File) and their helpers
// (createManagerWithAccount) live in @cmd-hub/storage-mongo. UI plugins and
// other consumers should import them from there directly. The framework
// itself only depends on the abstract repo interfaces in @cmd-hub/common.

// Constants
export * from './constants'

// Core types
export * from './types'

// UI symbols
export { UiUnicodeSymbols } from './ui/ui-unicode-symbols'

// Message lifecycle
export { MessageLifecycleManager } from './ui/message-lifecycle'
export type { MessageType } from './ui/message-lifecycle'

// Config registry
export { ConfigRegistry } from './config-registry'
export type { ConfigModuleDef } from './config-registry'

// Utils
export { TableDesigner, escapeHtml } from './utils/table-designer'
export { isValidConfigPath } from './utils/validation'
export type { TableField, TextField, MarkupField } from './utils/table-designer'
export { shuffle } from './utils/array'
export { anyToString } from './utils/misc'

// Calibration callback (used by UIs wiring the /calibrate flow)
export { handleCalibrationCallback, CALIBRATE_CB_PREFIX, CALIBRATE_WIDTHS } from './ui/command-processor/built-in-cmd/calibrate-cmd'
