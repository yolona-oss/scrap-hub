import { z } from 'zod'
import * as fs from 'fs/promises'
import find from 'find-process'

import { LockManager } from './lock-manager'
import { WithInit } from '../types/with-init'
import type { IRunnable } from '../types/runnable'
import { Phase } from './phase'
import {
    IAppMiddleware,
    AppMiddleware,
    AppLike,
    ConfigContributor,
    isConfigContributor,
} from './middleware-types'
import log from './logger'

export interface ApplicationOptions<Cfg> {
    /** Path to a JSON config file. Ignored when `inlineConfig` is provided. */
    configPath: string
    /** Base config schema. Middleware config contributors are merged into this as
     *  top-level namespace keys. */
    baseSchema: z.ZodType<unknown>
    /** Optional escape hatch — when set, file loading is bypassed and this value
     *  is fed through schema validation directly. */
    inlineConfig?: Cfg
    /** Optional app id; defaults to 'app'. Used for the lock file name. */
    name?: string
}

export abstract class Application<Cfg = unknown> extends WithInit implements IRunnable {
    private _isRunning: boolean = false
    private _isInited: boolean = false
    public readonly id: string
    public readonly config!: Cfg

    /** Shared mutable bag middlewares use to publish capabilities (e.g.
     *  `context.httpAgent` from ProxyMiddleware). Framework consumers read
     *  through here instead of reaching into the Application instance itself.
     *  Keys should be unique across middlewares; no namespace enforcement yet. */
    public readonly context: Record<string, unknown> = {}

    protected readonly lockManager: LockManager = new LockManager(`./.lock`)

    private readonly _middlewares: IAppMiddleware[] = []
    /** Middlewares that successfully installed, in install order. Rollback
     *  and terminate iterate this list in reverse, so middlewares whose
     *  install() never ran (or threw) are never handed an uninstall call. */
    private _installedMiddlewares: IAppMiddleware[] = []

    private _sigHandler: (() => Promise<void>) | null = null

    constructor(readonly opts: ApplicationOptions<Cfg>) {
        super()
        this.id = opts.name ?? 'app'
    }

    isRunning(): boolean {
        return this._isRunning
    }

    /** Register an application middleware. Middlewares are installed sorted by
     *  phase (ascending) during Initialize() and uninstalled in reverse order
     *  during terminate(). */
    use(mw: AppMiddleware): this {
        if (typeof mw === 'function') {
            const fnMw: IAppMiddleware = {
                phase: Phase.Infrastructure,
                install: async (app: AppLike) => {
                    const maybeTeardown = await mw(app)
                    if (typeof maybeTeardown === 'function') {
                        ;(fnMw as IAppMiddleware & { _teardown?: () => unknown })._teardown = maybeTeardown
                    }
                },
                uninstall: async () => {
                    const t = (fnMw as IAppMiddleware & { _teardown?: () => Promise<void> | void })._teardown
                    if (typeof t === 'function') await t()
                },
            }
            this._middlewares.push(fnMw)
        } else {
            this._middlewares.push(mw)
        }
        return this
    }

    async Initialize(): Promise<void> {
        if (this._isInited) {
            throw new Error('Application already initialized')
        }

        // 1. Build merged schema from baseSchema + middleware/subclass contributors.
        const mergedSchema = this._buildMergedSchema()

        // 2. Load raw config (inline takes precedence; otherwise read JSON file).
        let raw: unknown
        if (this.opts.inlineConfig !== undefined) {
            raw = this.opts.inlineConfig
        } else {
            let text: string
            try {
                text = await fs.readFile(this.opts.configPath, 'utf8')
            } catch (e) {
                throw new Error(`cannot read config at ${this.opts.configPath}: ${(e as Error).message}`)
            }
            try {
                raw = JSON.parse(text)
            } catch (e) {
                throw new Error(`invalid JSON in ${this.opts.configPath}: ${(e as Error).message}`)
            }
        }

        // 3. Validate + assign.
        const parsed = mergedSchema.parse(raw)
        ;(this as unknown as { config: Cfg }).config = parsed as Cfg

        // 3a. Apply post-bootstrap logger config. If the validated config
        //     carries a `log` namespace (subclass-contributed), those values
        //     override the env-var bootstrap defaults. Any field is optional.
        const logSlice = (parsed as { log?: { level?: string; toFile?: boolean } } | null)?.log
        if (logSlice && typeof logSlice === 'object') {
            log.configure({ level: logSlice.level, toFile: logSlice.toFile })
        }

        // 4. Acquire process lock.
        await this.lockApp()

        // 5. Register signal handlers. Paired with removal in terminate()
        //    so a failed init followed by no terminate() never leaks them.
        this._sigHandler = async () => {
            log.info("Signal received. Terminating...")
            await this.terminate()
        }
        process.on("SIGINT", this._sigHandler)
        process.on("SIGTERM", this._sigHandler)

        // 6. Install middlewares sorted by phase (ascending). If any middleware
        //    install throws, roll back only the middlewares that actually ran
        //    (in reverse order) and release the process lock so a subsequent
        //    Initialize() can retry cleanly.
        try {
            await this._installMiddlewares()
        } catch (e) {
            try { await this._uninstallInstalled() } catch { /* swallow */ }
            try { this.lockManager.cleanupAll() } catch { /* swallow */ }
            if (this._sigHandler) {
                process.removeListener("SIGINT", this._sigHandler)
                process.removeListener("SIGTERM", this._sigHandler)
                this._sigHandler = null
            }
            throw e
        }

        this._isInited = true
        this.setInitialized()
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

    abstract run(): Promise<void>

    async terminate(): Promise<void> {
        // Uninstall only middlewares that actually installed, in reverse
        // phase order. Errors in one middleware's uninstall must not block
        // others.
        await this._uninstallInstalled()

        log.info("Application::terminate() cleanup lock files...")
        this.lockManager.cleanupAll()

        // Detach signal handlers so repeated new-Application/terminate cycles
        // (common in tests) don't leak listeners.
        if (this._sigHandler) {
            process.removeListener("SIGINT", this._sigHandler)
            process.removeListener("SIGTERM", this._sigHandler)
            this._sigHandler = null
        }

        this._isRunning = false
        this._isInited = false
        this.setUninitialized()
    }

    private async isPreviousRunning() {
        const pid = this.lockManager.getLockFileData(this.id)
        if (typeof pid !== "string") {
            return false
        }
        // Stale self-pid (leftover from an earlier in-process Initialize that
        // threw after acquiring the lock) is not an external instance.
        if (pid.trim() === String(process.pid)) {
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
                throw new Error("Application.lockApp() application with same id already running")
            }
        }
        createLock()
    }

    protected async _installMiddlewares(): Promise<void> {
        const sorted = [...this._middlewares].sort((a, b) => a.phase - b.phase)
        this._installedMiddlewares = []
        for (const mw of sorted) {
            await mw.install(this as unknown as AppLike)
            this._installedMiddlewares.push(mw)
        }
    }

    private async _uninstallInstalled(): Promise<void> {
        const reverse = [...this._installedMiddlewares].reverse()
        this._installedMiddlewares = []
        for (const mw of reverse) {
            if (mw.uninstall) {
                try {
                    await mw.uninstall(this as unknown as AppLike)
                } catch (e) {
                    log.error("Application::uninstall middleware teardown failed:", e)
                }
            }
        }
    }

    /** Subclass hook — cmd-hub / cmd-node add their own ConfigContributors here. */
    protected _collectSubclassContributors(): ConfigContributor[] {
        return []
    }

    private _buildMergedSchema(): z.ZodType<unknown> {
        const base = this.opts.baseSchema
        if (!(base instanceof z.ZodObject)) {
            // If user passed a non-object schema, we can't merge into it.
            return base
        }

        const contributors: ConfigContributor[] = []
        for (const mw of this._middlewares) {
            if (isConfigContributor(mw)) contributors.push(mw)
        }
        contributors.push(...this._collectSubclassContributors())

        // Group by namespace, detecting collisions on overlapping keys.
        const namespaceSchemas = new Map<string, z.AnyZodObject>()
        for (const c of contributors) {
            if (!(c.schema instanceof z.ZodObject)) {
                throw new Error(`contributor "${c.namespace}" schema must be a ZodObject`)
            }
            const incoming = c.schema as z.AnyZodObject
            const existing = namespaceSchemas.get(c.namespace)
            if (!existing) {
                namespaceSchemas.set(c.namespace, incoming)
                continue
            }
            const existingShape = existing.shape as Record<string, unknown>
            const newShape = incoming.shape as Record<string, unknown>
            for (const key of Object.keys(newShape)) {
                if (key in existingShape) {
                    throw new Error(
                        `config namespace collision: "${c.namespace}.${key}" is declared by ` +
                        `multiple contributors`,
                    )
                }
            }
            namespaceSchemas.set(c.namespace, existing.merge(incoming))
        }

        let merged: z.AnyZodObject = base as z.AnyZodObject
        for (const [ns, schema] of namespaceSchemas) {
            merged = merged.extend({ [ns]: schema })
        }
        return merged
    }
}
