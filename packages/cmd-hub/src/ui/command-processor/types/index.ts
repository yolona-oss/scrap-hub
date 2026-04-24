import { IManager } from '../../../db'
import { CmdDispatcher } from '../dispatcher'
import { CmdArgumentPairOptionsType } from '../../../ui/types/command'

export * from './handler'

export type ArgOptionsSetter = (servName: string, dispatcher: CmdDispatcher<any>, manager: IManager) => Promise<string[]>
export type ArgOptionsType = CmdArgumentPairOptionsType<ArgOptionsSetter>
export type ArgOptionValidator = (arg: string) => boolean
