import type { ManagerRecord } from '@cmd-hub/common'
import { CmdDispatcher } from '../dispatcher'
import { CmdArgumentPairOptionsType } from '../../../ui/types/command'

export * from './handler'

export type ArgOptionsSetter = (servName: string, dispatcher: CmdDispatcher<any>, manager: ManagerRecord) => Promise<string[]>
export type ArgOptionsType = CmdArgumentPairOptionsType<ArgOptionsSetter>
export type ArgOptionValidator = (arg: string) => boolean
