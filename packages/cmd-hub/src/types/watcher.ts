import { IRunnable } from "../types/runnable";

export interface IWatcher extends IRunnable{
    setFreq(hz: number): Promise<void>
}
