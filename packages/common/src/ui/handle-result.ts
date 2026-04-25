import type { IBaseMarkup } from './markup'

export type MessageType = 'builder' | 'dashboard' | 'system' | 'result'

export interface IHandleResult {
    success: boolean
    markup: IBaseMarkup
    messageType?: MessageType
}
