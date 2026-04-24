// @cmd-hub/core — hub runtime.
//
// Each package owns its public surface; we do NOT re-export siblings
// (ui-telegram / ui-cli / ui-web / transport / node) through here.

// Application lifecycle
export { AppCmdhub, CmdHubApp } from './cmdhub'
export type { IUIWithAttach } from './cmdhub'
export { Application } from './application'

// Middlewares
export { GrpcServerMiddleware } from './middleware/grpc-server-middleware'
export type { GrpcServerMiddlewareOptions } from './middleware/grpc-server-middleware'
export { UploadEndpointMiddleware } from './middleware/upload-endpoint-middleware'
export { CmdNodeClientMiddleware } from './middleware/cmd-node-client-middleware'

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

// Command types & decorators
export * from './ui/types/command'
export { BaseCommandService } from './ui/types/command/service'
export type { CmdServiceData, GlobalServiceConfig, ServiceContext } from './ui/types/command/service'

// Database
export { Manager, Account, AccountModule, AccountSession, File, CmdAlias, MsgHistory, DefaultAssets, FilesWrapper, MongoConnect, InvitationLink } from './db'
export type { IManager, IFile, IAccount, IAccountSession, IAccountModule, IInvitationLink } from './db'

// Config
export { ConfigSign, getConfig, getInitialConfig, createConfigIfNotExists, updateConfig } from './config'
export type { ConfigType } from './config'

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

// Message history types (for UIs that want to persist chat logs)
export type { IMsgHistory, IMsgHistoryDto } from './db/schemes/messages-history'

// Calibration callback (used by UIs wiring the /calibrate flow)
export { handleCalibrationCallback, CALIBRATE_CB_PREFIX, CALIBRATE_WIDTHS } from './ui/command-processor/built-in-cmd/calibrate-cmd'
