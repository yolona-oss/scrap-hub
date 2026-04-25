import { sleep } from './time'

const DEFAULT_THROTTLE_DELAY = 1000

/** Singleton throttler grouping work by `actionGroup` string. Ensures
 *  consecutive `throttle(group, fn)` calls within `ThrottleDelay(group)` ms
 *  serialize with a sleep between them. */
export class SingleThrottler {
    private static instance?: SingleThrottler

    private constructor() {}

    static get Instance(): SingleThrottler {
        if (!this.instance) {
            this.instance = new SingleThrottler()
        }
        return this.instance
    }

    SetThrottleDelay(group: string, throttleDelay: number): void {
        if (throttleDelay <= 0) {
            throw new Error('ThrottleDelay must be greater than 0')
        }
        this.throttleDelay.set(group, throttleDelay)
    }

    ThrottleDelay(group: string): number {
        return this.throttleDelay.get(group) || DEFAULT_THROTTLE_DELAY
    }

    private throttleMap = new Map<string, number>()
    private throttleDelay = new Map<string, number>()

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
