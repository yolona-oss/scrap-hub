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

// --- Distributed framework (Phase 1+) ---
// Protobuf contracts (namespaced to avoid name clashes with core types)
export * as CmdHubProto from './grpc/generated/cmd_node'
// Named re-exports of the commonly-used proto message types so UI plugin
// authors don't have to reach into CmdHubProto.* for normal usage.
export type {
    InvokeClient,
    InvokeServer,
    InvokeStart,
    IntercomAction,
    NodeManifest,
} from './grpc/generated/cmd_node'
// Named re-exports of the gRPC stubs so deployable apps can wire them up
// without importing from the generated module path.
export {
    CmdHubServiceClient,
    CmdNodeServiceClient,
} from './grpc/generated/cmd_node'

// Core domain types
export type {
    FileHandle,
    WriteGrant,
    NodeState,
    NodeRecord,
    SessionContext,
} from './distributed/types'
export { isFileHandle } from './distributed/types'

// File service
export type {
    FileServiceBackend,
    WriteGrantInput,
    IFileService,
} from './distributed/files/types'
export { FileService } from './distributed/files/file-service'
export { GridFSBackend } from './distributed/files/gridfs-backend'
export type { GridFSBackendOptions } from './distributed/files/gridfs-backend'

// Auth seams
export type {
    ICertVerifier,
    ITokenVerifier,
    CertVerificationInput,
} from './distributed/auth/types'
export { InternalCertVerifier } from './distributed/auth/internal-cert-verifier'
export { InternalTokenVerifier } from './distributed/auth/internal-token-verifier'

// Node registry + manifest aggregation
export { CmdNodeRegistry } from './distributed/registry/cmd-node-registry'
export type {
    ProvisionInput,
    ProvisionOutput,
    MarkRegisteredInput,
} from './distributed/registry/cmd-node-registry'
export { CommandPool } from './distributed/pool/command-pool'
export type { PoolCommand, PoolMember, PoolJoinResult } from './distributed/pool/command-pool'
export { ManifestAggregator } from './distributed/pool/manifest-aggregator'
export type { AggregatedManifest, AttachResult } from './distributed/pool/manifest-aggregator'

// Dispatch + session index
export { HubDispatcher } from './distributed/dispatcher/hub-dispatcher'
export type {
    HandleInput,
    HandleResult,
    BuiltInHandler,
} from './distributed/dispatcher/hub-dispatcher'
export { SessionIndex } from './distributed/session/session-index'
export type { SessionEntry } from './distributed/session/session-index'

// Node-client abstraction
export type { ICmdNodeClient, InvocationHandle } from './distributed/client/cmd-node-client'
export { FakeCmdNodeClient } from './distributed/client/fake-cmd-node-client'
export type { FakeHandler } from './distributed/client/fake-cmd-node-client'

// DB models (re-exported for advanced use)
export { NodeRecordModel } from './distributed/db/node-record.model'
export { FileMetadataModel } from './distributed/db/file-metadata.model'
export type { FileMetadataDoc } from './distributed/db/file-metadata.model'

// Built-in factories (for custom CmdHubApp assemblies)
export { makeNodeBuiltIn } from './distributed/builtins/node'
export type { NodeBuiltInDeps } from './distributed/builtins/node'
export { makeHelpBuiltIn } from './distributed/builtins/help'
export type { HelpBuiltInDeps } from './distributed/builtins/help'
export { makeConfigBuiltIn } from './distributed/builtins/config'
export type { ConfigBuiltInDeps, ConfigReloadCallback } from './distributed/builtins/config'
export { makeSConfigBuiltIn } from './distributed/builtins/sconfig'
export type { SConfigBuiltInDeps } from './distributed/builtins/sconfig'
export { makeServiceCtrlBuiltIn } from './distributed/builtins/service-ctrl'
export type { ServiceCtrlBuiltInDeps } from './distributed/builtins/service-ctrl'

// Config/sconfig stores
export {
    MongoSystemConfigStore,
    SystemConfigModel,
} from './distributed/builtins/config-store'
export type { ISystemConfigStore } from './distributed/builtins/config-store'
export {
    MongoAccountModuleStore,
    AccountConfigModel,
} from './distributed/builtins/sconfig-store'
export type { IAccountModuleStore } from './distributed/builtins/sconfig-store'

// Top-level app
export { CmdHubApp } from './distributed/app/cmd-hub-app'
export type { CmdHubAppOptions, IHubUIPlugin } from './distributed/app/cmd-hub-app'

// gRPC server + metrics (Phase 2)
export { MetricStore } from './distributed/metrics/metric-store'
export { makeCmdHubServiceImpl } from './distributed/grpc-server/cmd-hub-service-impl'
export type { CmdHubServiceDeps, FingerprintResolver } from './distributed/grpc-server/cmd-hub-service-impl'
export { startHubGrpcServer } from './distributed/grpc-server/server'
export type { HubGrpcServerOptions, HubGrpcServerHandle } from './distributed/grpc-server/server'
export { GrpcCmdNodeClient, InMemoryChannelResolver } from './distributed/client/grpc-cmd-node-client'
export type { NodeChannelResolver } from './distributed/client/grpc-cmd-node-client'
export {
    hubServerCredentialsFromPaths,
    nodeChannelCredentialsFromPaths,
    mTlsFingerprintResolver,
} from './distributed/grpc-server/tls'
export type { HubTlsPaths, ClientTlsPaths } from './distributed/grpc-server/tls'
export { makeUploadEndpoint } from './distributed/files/upload-endpoint'
export type { UploadEndpointDeps, GrantAccess } from './distributed/files/upload-endpoint'
