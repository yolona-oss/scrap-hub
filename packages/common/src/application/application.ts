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
import type { CapabilityKey, ICapabilityRegistry } from './capability'
import {
    AppManifestSnapshot,
    CapabilityDescriptor,
    CommandRegistration,
    CapabilityValidationError,
    CapabilityValidationFailure,
} from './manifest'
import log from './logger'

export interface ApplicationOptions<Cfg> {
    /** JSON config file path; ignored when `inlineConfig` is set. */
    configPath: string
    /** Middleware/subclass config contributors are merged into this as top-level keys. */
    baseSchema: z.ZodType<unknown>
    /** When set, bypasses file loading and is fed through schema validation directly. */
    inlineConfig?: Cfg
    /** App id; used for the lock file name. */
    name?: string
}

export abstract class Application<Cfg = unknown>
    extends WithInit
    implements IRunnable, ICapabilityRegistry
{
    private _isRunning: boolean = false
    private _isInited: boolean = false
    /** Memoizes in-flight terminate(); concurrent callers (e.g. SIGINT then
     *  SIGTERM in the same tick) await the same promise rather than each
     *  running their own teardown. */
    private _terminating: Promise<void> | null = null
    public readonly id: string
    private _config!: Cfg
    public get config(): Cfg {
        return this._config
    }

    /** Runtime backing for the typed capability registry. Closed —
     *  consumers go through `provide` / `get` / `has` / `revoke`. */
    private readonly context: Record<string, unknown> = {}

    /** Side-band: which middleware (if any) provided each cap. Pruned on revoke. */
    private readonly _providers: Map<string, string> = new Map()

    provide<V>(key: CapabilityKey<V>, value: V, providedBy?: string): void {
        this.context[key] = value
        this._providers.set(key, providedBy ?? '')
    }

    get<V>(key: CapabilityKey<V>): V | undefined {
        const raw = this.context[key]
        return raw === undefined ? undefined : (raw as V)
    }

    revoke<V>(key: CapabilityKey<V>): void {
        delete this.context[key]
        this._providers.delete(key)
    }

    has<V>(key: CapabilityKey<V>): boolean {
        return key in this.context
    }

    protected readonly lockManager: LockManager = new LockManager(`./.lock`)

    private readonly _middlewares: IAppMiddleware[] = []
    /** In install order; rollback/terminate iterate this list in reverse so
     *  middlewares whose install() never ran are never handed uninstall. */
    private _installedMiddlewares: IAppMiddleware[] = []

    private _sigHandler: (() => Promise<void>) | null = null

    constructor(readonly opts: ApplicationOptions<Cfg>) {
        super()
        this.id = opts.name ?? 'app'
    }

    isRunning(): boolean {
        return this._isRunning
    }

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
        log.info(`Application "${this.id}": Initialize() begin`)

        const mergedSchema = this._buildMergedSchema()

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

        const parsed = mergedSchema.parse(raw) as Cfg
        this._config = parsed

        // Subclass-contributed `log` namespace overrides env-var bootstrap defaults.
        interface LogSlice { log?: { level?: string; toFile?: boolean } }
        const logSlice = (parsed as LogSlice | null | undefined)?.log
        if (logSlice && typeof logSlice === 'object') {
            log.configure({ level: logSlice.level, toFile: logSlice.toFile })
        }

        await this.lockApp()

        // Paired with removal in terminate() so a failed init never leaks listeners.
        this._sigHandler = async () => {
            log.info("Signal received. Terminating...")
            await this.terminate()
        }
        process.on("SIGINT", this._sigHandler)
        process.on("SIGTERM", this._sigHandler)

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

        try {
            this._validateRegisteredCommands()
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
        log.info(`Application "${this.id}": Initialize() done`)
    }

    private _validateRegisteredCommands(): void {
        const registered = this._collectRegisteredCommands()
        const failures: CapabilityValidationFailure[] = []
        for (const cmd of registered) {
            const missing = cmd.requires.filter(key => !(key in this.context))
            if (missing.length > 0) {
                failures.push({ commandName: cmd.name, missing })
            }
        }
        if (failures.length > 0) {
            throw new CapabilityValidationError(failures)
        }
    }

    /** Read-only wiring snapshot. Doesn't hold references back into mutable state. */
    manifestSnapshot(): AppManifestSnapshot {
        const capabilities: CapabilityDescriptor[] = Array.from(this._providers.entries())
            .map(([key, providedBy]) => ({ key, providedBy }))
        const commands = this._collectRegisteredCommands().map(c => ({
            name: c.name,
            requires: [...c.requires],
        }))
        return { capabilities, commands }
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
        if (this._terminating) {
            return this._terminating
        }
        this._terminating = (async () => {
            await this._uninstallInstalled()

            log.info("Application::terminate() cleanup lock files...")
            this.lockManager.cleanupAll()

            if (this._sigHandler) {
                process.removeListener("SIGINT", this._sigHandler)
                process.removeListener("SIGTERM", this._sigHandler)
                this._sigHandler = null
            }

            this._isRunning = false
            this._isInited = false
            this.setUninitialized()
        })()
        return this._terminating
    }

    private async isPreviousRunning() {
        const pid = this.lockManager.getLockFileData(this.id)
        if (typeof pid !== "string") {
            return false
        }
        // Stale self-pid (leftover from a thrown in-process Initialize) isn't external.
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
        log.info(`Application "${this.id}": installing ${sorted.length} middleware(s)`)
        for (const mw of sorted) {
            log.debug(`Application "${this.id}": install ${mw.name ?? '(anon)'} @ phase ${mw.phase}`)
            await mw.install(this)
            this._installedMiddlewares.push(mw)
        }
        log.info(`Application "${this.id}": all middlewares installed`)
    }

    private async _uninstallInstalled(): Promise<void> {
        const reverse = [...this._installedMiddlewares].reverse()
        this._installedMiddlewares = []
        for (const mw of reverse) {
            if (mw.uninstall) {
                try {
                    log.debug(`Application "${this.id}": uninstall ${mw.name ?? '(anon)'}`)
                    await mw.uninstall(this)
                } catch (e) {
                    log.error("Application::uninstall middleware teardown failed:", e)
                }
            }
        }
    }

    /** Subclass hook — cmd-hub/cmd-node add their own ConfigContributors here. */
    protected _collectSubclassContributors(): ConfigContributor[] {
        return []
    }

    /** Subclass hook — surfaces every registered command for boot-time validation
     *  and the manifest snapshot. */
    protected _collectRegisteredCommands(): CommandRegistration[] {
        return []
    }

    private _buildMergedSchema(): z.ZodType<unknown> {
        const base = this.opts.baseSchema
        if (!(base instanceof z.ZodObject)) return base

        const contributors: ConfigContributor[] = []
        for (const mw of this._middlewares) {
            if (isConfigContributor(mw)) contributors.push(mw)
        }
        contributors.push(...this._collectSubclassContributors())

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
