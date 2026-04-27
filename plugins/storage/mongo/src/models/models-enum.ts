/**
 * Canonical mongoose model names. Kept as an enum so cross-schema `ref`
 * declarations don't drift. Names are durable — changing them silently
 * orphans documents in deployed databases.
 */
export enum DbModelsEnum {
    Managers = 'managers',
    Accounts = 'accounts',
    AccountModules = 'account_modules',
    AccountSessions = 'account_sessions',
    MsgHistory = 'message_history',
    CmdAliases = 'cmd_aliases',
    PendingDeletes = 'pending_deletes',
    SystemConfigs = 'system_configs',
    UserConfigs = 'user_configs',
    InvitationLinks = 'invitation_links',
    SessionLog = 'session_log',
}
