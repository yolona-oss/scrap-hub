import { LockManager } from "@utils/lock-manager";
import { createConfigIfNotExists, getConfig } from "@core/config";
import { MongoConnect } from "@core/db/mongoose";
import { BaseUIContext, IUI } from "@core/ui/types";

import { IRunnable } from "@core/types/runnable";
import { Identificable } from "@core/types/identificable";
import { WithInit } from "@core/types/with-init";

import find from "find-process";
import mongoose from "mongoose";
import { configDotenv } from "dotenv";
import log from '@logger';

configDotenv({
    path: '.env'
})

export abstract class Application<CtxType extends BaseUIContext> extends WithInit implements IRunnable, Identificable {
    private _isRunning: boolean = false
    public readonly id: string

    protected ui: IUI<CtxType>

    protected readonly lockManager: LockManager = new LockManager(`./.lock`)

    constructor(
        name: string,
        ui: IUI<CtxType>
    ) {
        super()
        this.ui = ui
        this.id = name
        process.on("SIGINT", async () => {
            log.info("SIGINT received. Terminating...")
            await this.terminate()
        });
        process.on("SIGTERM", async () => {
            log.info("SIGINT received. Terminating...")
            await this.terminate()
        });
    }

    isRunning(): boolean {
        return this._isRunning
    }

    async Initialize(): Promise<void> {
        try {
            await createConfigIfNotExists()

            log.info("Application::setup() checking lock...")
            await this.lockApp()

            const plzkillme = await getConfig()
            await MongoConnect(
                plzkillme.server.database.mongoose.connectionUri,
                plzkillme.server.database.mongoose.connectionOptions
            )

            // Migrate non-bootstrap config modules from config.json to MongoDB
            const { ConfigRegistry } = await import('@core/config-registry')
            await ConfigRegistry.migrateToMongoDB()
        } catch (e: any) {
            log.error("App preinitialization failed:", e);
            process.exit(-1)
        }
    }

    private _prevErrorHandler?: (error: Error) => void

    public setErrorInterceptor(handler: (error: Error, origin?: NodeJS.UncaughtExceptionOrigin) => void) {
        if (this._prevErrorHandler) {
            process.removeListener("uncaughtException", this._prevErrorHandler)
            process.removeListener("unhandledRejection", this._prevErrorHandler)
        }

        this._prevErrorHandler = handler
        process.on("uncaughtException", handler)
        process.on("unhandledRejection", handler)
    }

    public removeLock(hash: string) {
        this.lockManager.deleteLockFile(LockManager.createLockFileName(hash))
    }

    async run() {
        if (!this.isInitialized()) {
            log.error("Application. Incoreect implementations of Initialize(). Not setInitialized() called.")
            process.exit(-1)
        }

        if (this._isRunning) {
            throw new Error("Application::run() called when already active")
        }

        try {
            log.info("Application::run() ui running...")
            await this.ui.run()

            log.info("Application::run() processing...")
        } catch (e: any) {
            log.error("Application::run() failed ui start:", e);
            log.error("Forse terminating.")
            await this.terminate()
        }

        this._isRunning = true

        //while (this.isRunning()) {
        //    await sleep(1000)
        //}
    }

    async terminate() {
        if (this.ui.isRunning()) {
            await this.ui.terminate()
        } else {
            log.info("Application::terminate() UI not running")
        }
        log.info("Application::terminate() cleanup lock files...")
        this.lockManager.cleanupAll()
        await mongoose.disconnect()
        this._isRunning = false
        process.exit(0)
    }

    private async isPreviousRunning() {
        const pid = this.lockManager.getLockFileData(this.id)
        if (typeof pid !== "string") {
            return false
        }
        return (await find("pid", pid)).length > 0
    }

    private async lockApp() {
        const createLock = () => {
            this.lockManager.deleteLockFile(LockManager.createLockFileName(this.id))
            this.lockManager.createLockFile(this.id, process.pid.toString())
        }

        const lock = this.lockManager.createLockFile(this.id, process.pid.toString())
        if (!lock) {
            if (await this.isPreviousRunning()) {
                throw new Error("Application.lockApp() application with spame id already running")
            }
        }
        createLock()
    }

}
