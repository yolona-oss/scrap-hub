// Application lifecycle
export { AppCmdhub } from './cmdhub'
export { Application } from './application'

// Command system
export { CmdDispatcher } from './ui/command-processor'
export * from './ui/command-processor/types'
export { AbstractCmdHandler } from './ui/command-processor/handlers/abstract-handler'

// UI abstractions & implementations
export { BaseUI } from './ui/base-ui'
export { BaseUIContext } from './ui/types/context'
export type { IUI, MessageOptions } from './ui/types/ui'
export type { IUIPlugin } from './ui/types/plugin'
export { UIRegistry } from './ui/registry'
export type { UIFactory } from './ui/registry'

// Built-in UIs
export { TelegramUI } from './ui/impls/telegram'
export type { TgContext, ITelegramPlugin } from './ui/impls/telegram/types'
export { CLIUI } from './ui/impls/cli'
export type { CLIContext, ICLIPlugin } from './ui/impls/cli/types'
export { WebUI, InvitationLink } from './ui/impls/web'
export type { WebContext, IWebUIPlugin } from './ui/impls/web/types'

// Command types & decorators
export * from './ui/types/command'
export { BaseCommandService } from './ui/types/command/service'
export type { CmdServiceData, GlobalServiceConfig, ServiceContext } from './ui/types/command/service'

// Database
export { Manager, Account, AccountModule, AccountSession, File, CmdAlias, MsgHistory, DefaultAssets, FilesWrapper, MongoConnect } from './db'
export type { IManager, IFile, IAccount, IAccountSession, IAccountModule } from './db'

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
