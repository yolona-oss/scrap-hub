import { sleep } from "./time"

const DEFAULT_THROTTLE_DELAY = 1000

export class SingleThrottler {
    private static instance?: SingleThrottler

    private constructor() {

    }

    static get Instance() {
        if (!this.instance) {
            this.instance = new SingleThrottler()
        }
        return this.instance
    }

    SetThrottleDelay(group: string, throttleDelay: number) {
        if (throttleDelay <= 0) {
            throw new Error("ThrottleDelay must be greater than 0")
        }
        this.throttleDelay.set(group, throttleDelay)
    }

    ThrottleDelay(group: string) {
        return this.throttleDelay.get(group) || DEFAULT_THROTTLE_DELAY
    }

    private throttleMap: Map<string, number> = new Map<string, number>() // { actionGroup: lastExecutedTime }
    private throttleDelay: Map<string, number> = new Map<string, number>()

    public async throttle<T>(actionGroup: string, action: () => Promise<T>): Promise<T> {
        if (!this.throttleMap.has(actionGroup)) {
            this.throttleMap.set(actionGroup, Date.now())
        }

        const lastExecutedTime = this.throttleMap.get(actionGroup)!

        const delay = this.throttleDelay.get(actionGroup) || DEFAULT_THROTTLE_DELAY
        if (Date.now() - lastExecutedTime < delay) {
            await sleep(delay - (Date.now() - lastExecutedTime))
        }

        this.throttleMap.set(actionGroup, Date.now())

        return await action()
    }
}
