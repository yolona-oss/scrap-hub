import { EventEmitter } from 'events'
import { sleep } from './time'
import log from '@logger'
import { IWatcher } from '@core/types/watcher'

export interface WatcherOpts {
        freq: number
}

export interface MarketWatcherOpts extends WatcherOpts {
        argession: number
}

const defaultMarketWatcherOpts: MarketWatcherOpts = {
    argession: 0.5,
    freq: 1
}

export class Watcher extends EventEmitter implements IWatcher {
    private active: boolean = false
    private sleepTime: number

    constructor(
        private watchFn: Function,
        private opts?: MarketWatcherOpts,
    ) {
        super()
        this.opts = {
            ...defaultMarketWatcherOpts,
            ...opts
        }
        this.sleepTime = 1000/this.opts.freq 
    }

    public isRunning() {
        return this.active
    }

    get Settings() {
        return this.opts
    }

    protected async updateState(f: Function) {
        let restart = false
        if (this.active) {
            await this.terminate()
            restart = true
        }
        f()
        if (restart) {
            this.run()
        }
    }

    async setFreq(hz: number): Promise<void> {
        return await this.updateState(() => {
            this.opts!.freq = hz,
            this.sleepTime = 1000/hz
        })
    }

    async run() {
        if (this.active) {
            throw new Error("Watcher.run() called when not active")
        }
        this.active = true
        this.watch()
    }

    private async watch() {
        const iter_start = new Date().getTime()
        try {
            await this.watchFn()
        } catch (e) {
            log.error("Cannot analize:", e)
        }

        if (!this.active) {
            this.emit("terminated")
            return
        } else {
            const elapced = new Date().getTime() - iter_start
            if (this.sleepTime - elapced > 0) {
                await sleep(this.sleepTime - elapced)
            }
            await this.watch()
        }
    }

    async terminate(): Promise<void> {
        return new Promise(resolve => {
            if (!this.active) {
                throw new Error("Watcher.terminate() called when not active")
            }
            this.active = false
            this.on("terminated", () => resolve)
        })
    }

}
