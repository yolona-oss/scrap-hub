import { defineCapability } from '../application/capability'
import type { IStorageConnection } from './types'
import type {
    ISystemConfigRepo, IUserConfigRepo, INodeRecordRepo,
    IManagerRepo, IAccountRepo, IInvitationLinkRepo,
    ICmdAliasRepo, IPendingDeleteRepo,
} from './repos'
import type { IServiceStore } from '../service/service-store'

export const CAP_StorageConnection   = defineCapability<IStorageConnection>('common.storageConnection')
export const CAP_SystemConfigRepo    = defineCapability<ISystemConfigRepo>('common.systemConfigRepo')
export const CAP_UserConfigRepo      = defineCapability<IUserConfigRepo>('common.userConfigRepo')
export const CAP_NodeRecordRepo      = defineCapability<INodeRecordRepo>('common.nodeRecordRepo')
export const CAP_ManagerRepo         = defineCapability<IManagerRepo>('common.managerRepo')
export const CAP_AccountRepo         = defineCapability<IAccountRepo>('common.accountRepo')
export const CAP_InvitationLinkRepo  = defineCapability<IInvitationLinkRepo>('common.invitationLinkRepo')
export const CAP_CmdAliasRepo        = defineCapability<ICmdAliasRepo>('common.cmdAliasRepo')
export const CAP_PendingDeleteRepo   = defineCapability<IPendingDeleteRepo>('common.pendingDeleteRepo')
export const CAP_ServiceStore        = defineCapability<IServiceStore>('common.serviceStore')
