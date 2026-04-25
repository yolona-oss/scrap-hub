import type { IRunnable } from './runnable'

/** Periodic watcher: runnable + tunable frequency. */
export interface IWatcher extends IRunnable {
    setFreq(hz: number): Promise<void>
}
