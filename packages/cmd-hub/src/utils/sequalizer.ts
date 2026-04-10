import { IRunnable } from "@core/types/runnable"
import { ICommand } from '@core/types/command'
import { AbstractState } from "@core/types/state"
import { asId, Identificable, isIdentifiable } from "@core/types/identificable"

import { HMSTime, sleep } from './time'

import log from '@logger'

import EventEmitter from "events"

type ITask<CmdRes = void, DataType = never> = {
    command: ICommand<CmdRes>
    data?: DataType,
    after?: string
    delay?: HMSTime
} & Identificable

interface SequalizerMetrics {
    activeTasks: number
    totalTasks: number
    awaitingTasks: number
    processedTasks: number
    errors: number
    avgExecTime: number
    minExecTime: number
    maxExecTime: number
}

class SequalizerCtx {
    private _metrics: SequalizerMetrics
    private concurrency: number = 10

    constructor(
        private state: SequalizerState
    ) {
        this.transitionTo(state)
        this._metrics = {
            activeTasks: 0,
            totalTasks: 0,
            awaitingTasks: 0,
            processedTasks: 0,
            errors: 0,
            avgExecTime: 0,
            minExecTime: 0,
            maxExecTime: 0
        }
    }

    public transitionTo(state: SequalizerState) {
        this.state = state
        this.state.setContext(this)
    }

    public getConcurrency() {
        return this.concurrency
    }

    public setConcurrency(concurrency: number) {
        this.concurrency = concurrency
    }

    public metrics(): SequalizerMetrics {
        return this._metrics
    }

    // TODO add state new state for this update, it will be optional exec time calc
    public upateExeTime(execTime: number) {
        this._metrics.avgExecTime = (this._metrics.avgExecTime * this._metrics.processedTasks + execTime) / (this._metrics.processedTasks + 1)
        this._metrics.minExecTime = Math.min(this._metrics.minExecTime, execTime)
        this._metrics.maxExecTime = Math.max(this._metrics.maxExecTime, execTime)
    }

    public updateTaskDone() {
        this._metrics.activeTasks--
        this._metrics.totalTasks--
        this._metrics.processedTasks++
    }

    public incrementAwaitingTasks() {
        this._metrics.awaitingTasks++
    }

    public decrementAwaitingTasks(v = 1) {
        this._metrics.awaitingTasks -= v
    }

    public updateError(e: any) {
        e
        this._metrics.errors++
    }
}

interface ISeqaulizerStateBase {
}

class SequalizerState extends AbstractState<SequalizerCtx> implements ISeqaulizerStateBase {
    constructor() {
        super()
    }
}

export class Sequalizer implements IRunnable {
    private _isRunning: boolean = false
    private executingTasksId = new Array<string>
    private taskQueue: ITask<any, any>[] = []

    // rename me plz:>
    private awaitingTasksId: string[] = []

    private ctx: SequalizerCtx

    private emitter: EventEmitter

    private id_history: string[] = []

    constructor(concurrency?: number) {
        this.emitter = new EventEmitter()
        this.ctx = new SequalizerCtx(new SequalizerState())
        this.ctx.setConcurrency(concurrency || 10)
    }

    public isRunning(): boolean {
        return this._isRunning
    }

    public genId(): string {
        return asId(crypto.randomUUID())
    }

    static GenId(): string {
        return asId(crypto.randomUUID())
    }

    public getTasks(): ITask[] {
        return new Array().concat(this.taskQueue)
    }

    public async waitAll(): Promise<void> {
        while (this.ctx.metrics().activeTasks > 0) {
            await sleep(100)
        }
    }

    // NOTE: maybe create array of active id and search in those array and current taskQueue for required id or push reject
    waitTask(id: string, timeout: number = 10000): Promise<boolean> {
        return new Promise((resolve, reject) => {
            this.emitter.once(`task-${id}-done`, (error: boolean) => resolve(error))
            if (timeout) {
                setTimeout(() => reject("Sequalizer::waitTask() timeout"), timeout)
            }
        })
    }

    async waitTasksWithIdMatch(match: string) {
        const matchs = this.executingTasksId.filter((exeId) => exeId.includes(match))
        return await Promise.all(
            matchs.map(this.waitTask)
        )
    }

    public dropTasks(): {
        droped: number
        unDropable: number
    } {
        const droped = this.taskQueue.length
        this.taskQueue = []

        for (const waitId of this.awaitingTasksId) {
            this.emitter.removeAllListeners(`__${waitId}`)
            this.ctx.decrementAwaitingTasks(this.ctx.metrics().activeTasks)
        }

        this.ctx.metrics().totalTasks = 0
        return {
            unDropable: this.ctx.metrics().activeTasks,
            droped: droped
        }
    }

    public getMetrics(): SequalizerMetrics {
        return Object.assign({}, this.ctx.metrics())
    }

    public getConcurrency(): number {
        return this.ctx.getConcurrency()
    }

    private addToHistory(id: string) {
        if (this.id_history.length >= 1000) {
            this.id_history.splice(0, 100)
        }
        this.id_history.push(id)
    }

    async immidiate<T>({command}: ITask<T>): Promise<T> {
        return await command.execute()
    }

    enqueue<T>(task: ITask<T>): void {
        if (!this._isRunning) {
            throw new Error("Sequalizer::enqueue() Sequalizer is not running")
        }

        if (!isIdentifiable(task)) {
            throw new Error(`Sequalizer::enqueue() task must be identifiable. Maybe id is incorrect: "${(task as any)?.id}". Or task is fully invalid. ${JSON.stringify(task)}`)
        }

        const { after } = task

        this.ctx.metrics().totalTasks++

        if (after) {
            if (this.id_history.includes(after)) {
                this.taskQueue.push(task)
            } else {
                this.awaitingTasksId.push(after)
                this.ctx.incrementAwaitingTasks()

                this.emitter.once(`__${after}`, (success) => {
                    this.ctx.decrementAwaitingTasks()
                    this.awaitingTasksId.splice(this.awaitingTasksId.indexOf(after), 1)
                    if (success) {
                        this.taskQueue.push(task)
                    } else {
                        console.log("cascade drop: awaiting task failed")
                        this.ctx.metrics().totalTasks--
                    }
                })
            }
        } else {
            this.taskQueue.push(task)
        }

        //return new Promise((resolve, reject) => {
        //    const boundExecute = async () => {
        //        try {
        //            // NOTE: create history array with ids of completed and first lookup in history array if task.after already done,
        //            //       otherwise create event handler for completion task.after id then enqueue
        //            //       This ^ solution may be more efficient
        //            if (task.after) {
        //                this.ctx.setConcurrency(this.ctx.getConcurrency() + 1)
        //                await this.waitTask(task.after)
        //                this.ctx.setConcurrency(this.ctx.getConcurrency() - 1)
        //            }
        //            const result = await task.command.execute.apply(thisArg)
        //            resolve(result)
        //        } catch (error) {
        //            reject(error)
        //        }
        //    }
        //
        //    this.taskQueue.push({
        //        ...task,
        //        command: { execute: boundExecute }
        //    })
        //    this.processQueue()
        //})

        this.processQueue()
    }

    public unenqueue(id: string) {
        this.taskQueue = this.taskQueue.filter((task) => task.id !== id)
        this.ctx.metrics().totalTasks = this.taskQueue.length
    }

    // TODO create prototype function for array to reuse
    public filterQueue(fn: (task: ITask<any, any>) => boolean) {
        const removed = []
        const kept = []

        for (const task of this.taskQueue) {
            if (fn(task)) {
                kept.push(task)
            } else {
                removed.push(task)
            }
        }

        this.taskQueue = kept

        return {
            removed: removed,
            kept: kept
        }
    }

    private async processQueue() {
        if (this.ctx.metrics().activeTasks >= this.ctx.getConcurrency()
            ||
            this.taskQueue.length === 0
        ) {
            return
        }

        // NOTE: ?? may crush ?? other async microtask may shitf last before this?
        const task = this.taskQueue.shift()!
        this.ctx.metrics().activeTasks++

        this.executingTasksId.push(task.id)

        let isTaskError = false
        try {
            if (task.delay) {
                HMSTime.sleep(task.delay.toJSON())
            }
            const start = Date.now()
            await task.command.execute()
            this.ctx.upateExeTime(Date.now() - start)
        } catch(e: any) {
            isTaskError = true
            this.ctx.updateError(e)
            log.error(`Sequalizer::processQueue() error: ${e}`)
        } finally {
            this.addToHistory(String(task.id))
            this.executingTasksId.splice(this.executingTasksId.indexOf(task.id), 1)

            this.emitter.emit(`task-${task.id}-done`, isTaskError)
            this.emitter.emit(`__${task.id}`, !isTaskError)

            // in next tick remove listners
            setTimeout(() => this.emitter.removeAllListeners(`task-${task.id}-done`))
            this.ctx.updateTaskDone()
            this.processQueue()
        }
    }

    public async run() {
        if (this._isRunning) {
            log.warn("Sequalizer::run() called when already active")
            return
        }

        this._isRunning = true
        return this.processQueue()
    }

    public async terminate() {
        if (this._isRunning == false) {
            log.warn("Sequalizer::terminate() called when not active")
            return
        }
        this._isRunning = false
    }
}
