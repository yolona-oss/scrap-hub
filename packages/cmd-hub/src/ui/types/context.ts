import { IManager } from "@core/db"
import { AvailableUIsType } from "./../impls"

export abstract class BaseUIContext {
    abstract type: AvailableUIsType
    abstract manager: IManager & { userId: number|string }
    abstract reply: (...args: any) => Promise<any>
}
