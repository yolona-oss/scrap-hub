import { Range } from "@core/types/range"

export type TimeRange = Range

export function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

export function timeoutPromise(timeout: number): Promise<any> {
    return new Promise(function() {
        setTimeout(function() {
            throw new Error("Operation timed out")
        }, timeout)
    })
}
export async function randSleep(max: number = 1000, min: number = 100) {
    let ms = Math.round(Math.random() * (max-min) + min)
    return await sleep(ms)
}

export type IHMSMTime = {
    hour: number,
    minutes: number,
    seconds: number,
    milliseconds: number,
}

export class HMSTime {
    protected hour: number = 0
    protected minutes: number = 0
    protected seconds: number = 0
    protected milliseconds: number = 0

    constructor(time: Partial<IHMSMTime> = {}) {
        Object.assign(this, time)
    }

    static sleep(time: Partial<IHMSMTime>) {
        return new Promise(resolve =>
            setTimeout(resolve, new HMSTime(time).toMilliseconds())
        )
    }

    toString(format: string = "Y-m-d H:i:s:v"): string {
        //return `${this.hour}:${this.minutes}:${this.seconds}:${this.milliseconds}`
        let d = this.toDate()
        return format
            .replace(/Y/gm, d.getFullYear().toString())
            .replace(/m/gm, ('0' + (d.getMonth() + 1)).substr(-2))
            .replace(/d/gm, ('0' + (d.getDate() + 1)).substr(-2))
            .replace(/H/gm, ('0' + (d.getHours() + 0)).substr(-2))
            .replace(/i/gm, ('0' + (d.getMinutes() + 0)).substr(-2))
            .replace(/s/gm, ('0' + (d.getSeconds() + 0)).substr(-2))
            .replace(/v/gm, ('0000' + (d.getMilliseconds() % 1000)).substr(-3))
    }

    toJSON(): IHMSMTime {
        return {
            hour: this.hour,
            minutes: this.minutes,
            seconds: this.seconds,
            milliseconds: this.milliseconds,
        }
    }

    toMilliseconds(): number {
        return this.hour * 3600000 +
            this.minutes * 6000 +
            this.seconds * 1000 +
            this.milliseconds
    }

    toSeconds(): number {
        return this.toMilliseconds() / 1000
    }

    toMinutes(): number {
        return this.toSeconds() / 60
    }

    toHours(): number {
        return this.toMinutes() / 60
    }

    addToDate(date: Date = new Date()) {
        let copy = new Date(date)
        return new Date(
            copy.setTime(copy.getTime() + this.toMilliseconds())
        )
    }

    substractFromDate(date: Date = new Date()) {
        let copy = new Date(date)
        return new Date(
            copy.setTime(copy.getTime() - this.toMilliseconds())
        )
    }

    add(time: Partial<IHMSMTime>): HMSTime {
        this.hour += time.hour ?? 0
        this.minutes += time.minutes ?? 0
        this.seconds += time.seconds ?? 0
        this.milliseconds += time.milliseconds ?? 0
        return this
    }

    /***
        * Sugar for this.add that check if result of each time field is negative and sets to zero
        */
    substract(time: Partial<IHMSMTime>) {
        this.add(time)
        if (this.hour < 0) this.hour = 0
        if (this.minutes < 0) this.minutes = 0
        if (this.seconds < 0) this.seconds = 0
        if (this.milliseconds < 0) this.milliseconds = 0
        return this
    }

    addMilliseconds(milliseconds: number): HMSTime {
        return this.add({ milliseconds })
    }

    addSeconds(seconds: number): HMSTime {
        return this.add({ seconds })
    }

    addMinutes(minutes: number): HMSTime {
        return this.add({ minutes })
    }

    addHours(hour: number): HMSTime {
        return this.add({ hour })
    }

    get Hour() {
        return this.hour
    }

    get Minutes() {
        return this.minutes
    }

    get Seconds() {
        return this.seconds
    }

    get Milliseconds() {
        return this.milliseconds
    }

    toDate(): Date {
        return new Date(this.toMilliseconds())
    }
}
