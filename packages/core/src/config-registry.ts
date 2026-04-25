import * as fs from 'fs'
import type { ISystemConfigRepo, IUserConfigRepo } from '@cmd-hub/common'
import { main_config_path, isValidConfigPath } from '@cmd-hub/common'
import log from './application/logger'

export type ConfigScope = 'bootstrap' | 'system' | 'user'

export interface ConfigModuleDef {
    name: string
    defaults: Record<string, unknown>
    sensitive?: string[]
    scope: ConfigScope
}

/** Static config registry. Modules `register(...)` at load time;
 *  `ConfigBootMiddleware` later calls `attachRepos(...)`. Until then,
 *  system/user reads return defaults and writes throw. */
export class ConfigRegistry {
    private static modules = new Map<string, ConfigModuleDef>()
    private static bootstrapData: Record<string, unknown> = {}
    private static bootstrapLoaded = false
    private static systemRepo: ISystemConfigRepo | null = null
    private static userRepo: IUserConfigRepo | null = null

    static register(module: ConfigModuleDef): void {
        // Called at module-load time before logger is wired — do not log.
        ConfigRegistry.modules.set(module.name, module)
    }

    static attachRepos(systemRepo: ISystemConfigRepo, userRepo: IUserConfigRepo): void {
        ConfigRegistry.systemRepo = systemRepo
        ConfigRegistry.userRepo = userRepo
    }

    /** Idempotent seed: rows already in the store are left alone. */
    static async seedSystemDefaults(): Promise<void> {
        if (!ConfigRegistry.bootstrapLoaded) ConfigRegistry.loadBootstrap()
        const repo = ConfigRegistry.requireSystemRepo('seedSystemDefaults')

        for (const [name, mod] of ConfigRegistry.modules) {
            if (mod.scope === 'bootstrap') continue

            const fromFile = ConfigRegistry.bootstrapData[name]
            const fromFileObj = ConfigRegistry.coerceToRecord(fromFile)
            const seed = fromFileObj && Object.keys(fromFileObj).length > 0
                ? { ...mod.defaults, ...fromFileObj }
                : { ...mod.defaults }

            const existing = await repo.findByModule(name)
            if (existing) continue
            await repo.insertIfAbsent(name, seed)
            const tag = fromFileObj && Object.keys(fromFileObj).length > 0
                ? `migrated "${name}" from config.json`
                : `created "${name}" with defaults`
            log.info(`ConfigRegistry: ${tag} in system store`)
        }
    }

    // --- Bootstrap (config.json, sync, before DB) ---

    static loadBootstrap(): void {
        try {
            const raw = JSON.parse(fs.readFileSync(main_config_path).toString())
            ConfigRegistry.bootstrapData = ConfigRegistry.coerceToRecord(raw) ?? {}
            ConfigRegistry.bootstrapLoaded = true
        } catch (e: unknown) {
            const message = e instanceof Error ? e.message : String(e)
            console.error(`ConfigRegistry: failed to load bootstrap config: ${message}`)
        }
    }

    static getBootstrap<T = unknown>(moduleName: string): T {
        if (!ConfigRegistry.bootstrapLoaded) ConfigRegistry.loadBootstrap()
        const mod = ConfigRegistry.modules.get(moduleName)
        const defaults = mod?.defaults ?? {}
        const fileSection = ConfigRegistry.coerceToRecord(ConfigRegistry.bootstrapData[moduleName]) ?? {}
        return { ...defaults, ...fileSection } as T
    }

    // --- System config (repo-backed) ---

    static async getSystem<T = unknown>(moduleName: string): Promise<T> {
        const mod = ConfigRegistry.modules.get(moduleName)
        const defaults = mod?.defaults ?? {}
        if (!ConfigRegistry.systemRepo) return defaults as T
        try {
            const doc = await ConfigRegistry.systemRepo.findByModule(moduleName)
            return { ...defaults, ...(doc?.data ?? {}) } as T
        } catch {
            return defaults as T
        }
    }

    static async setSystem(moduleName: string, path: string, value: unknown): Promise<void> {
        if (!isValidConfigPath(path)) throw new Error(`Invalid config path: "${path}"`)
        const repo = ConfigRegistry.requireSystemRepo('setSystem')
        await repo.setPath(moduleName, path, value)
        const mod = ConfigRegistry.modules.get(moduleName)
        const isSensitive = mod?.sensitive?.some(s => path.toLowerCase().includes(s.toLowerCase())) ?? false
        log.trace(`ConfigRegistry: set system ${moduleName}.${path} = ${isSensitive ? '***' : JSON.stringify(value)}`)
    }

    static async clearSystem(moduleName: string): Promise<void> {
        const repo = ConfigRegistry.requireSystemRepo('clearSystem')
        await repo.clear(moduleName)
    }

    // --- User config (repo-backed) ---

    static async getUser<T = unknown>(moduleName: string, userId: string): Promise<T> {
        const mod = ConfigRegistry.modules.get(moduleName)
        const defaults = mod?.defaults ?? {}
        if (!ConfigRegistry.systemRepo || !ConfigRegistry.userRepo) return defaults as T
        try {
            const sysDoc = await ConfigRegistry.systemRepo.findByModule(moduleName)
            const userDoc = await ConfigRegistry.userRepo.findByUserAndModule(userId, moduleName)
            // Priority: user > system > defaults
            return { ...defaults, ...(sysDoc?.data ?? {}), ...(userDoc?.data ?? {}) } as T
        } catch {
            return defaults as T
        }
    }

    static async setUser(moduleName: string, userId: string, path: string, value: unknown): Promise<void> {
        if (!isValidConfigPath(path)) throw new Error(`Invalid config path: "${path}"`)
        const repo = ConfigRegistry.requireUserRepo('setUser')
        await repo.setPath(userId, moduleName, path, value)
        const mod = ConfigRegistry.modules.get(moduleName)
        const isSensitive = mod?.sensitive?.some(s => path.toLowerCase().includes(s.toLowerCase())) ?? false
        log.trace(`ConfigRegistry: set user[${userId}] ${moduleName}.${path} = ${isSensitive ? '***' : JSON.stringify(value)}`)
    }

    static async clearUser(moduleName: string, userId: string): Promise<void> {
        const repo = ConfigRegistry.requireUserRepo('clearUser')
        await repo.clear(userId, moduleName)
    }

    // --- Unified get / set (respects scope) ---

    static async get<T = unknown>(moduleName: string, userId?: string): Promise<T> {
        const mod = ConfigRegistry.modules.get(moduleName)
        if (!mod) return {} as T

        switch (mod.scope) {
            case 'bootstrap':
                return ConfigRegistry.getBootstrap<T>(moduleName)
            case 'system':
                return ConfigRegistry.getSystem<T>(moduleName)
            case 'user':
                if (userId) return ConfigRegistry.getUser<T>(moduleName, userId)
                return ConfigRegistry.getSystem<T>(moduleName)
        }
    }

    static async set(moduleName: string, path: string, value: unknown, userId?: string): Promise<void> {
        const mod = ConfigRegistry.modules.get(moduleName)
        if (!mod) throw new Error(`Config module "${moduleName}" not registered`)

        switch (mod.scope) {
            case 'bootstrap':
                if (!ConfigRegistry.bootstrapLoaded) ConfigRegistry.loadBootstrap()
                setNestedValue(ConfigRegistry.bootstrapData, `${moduleName}.${path}`, value)
                fs.writeFileSync(main_config_path, JSON.stringify(ConfigRegistry.bootstrapData, null, '    '))
                break
            case 'system':
                await ConfigRegistry.setSystem(moduleName, path, value)
                break
            case 'user':
                if (userId) {
                    await ConfigRegistry.setUser(moduleName, userId, path, value)
                } else {
                    await ConfigRegistry.setSystem(moduleName, path, value)
                }
                break
        }
    }

    // --- Query helpers ---

    static list(): string[] {
        return Array.from(ConfigRegistry.modules.keys())
    }

    static has(name: string): boolean {
        return ConfigRegistry.modules.has(name)
    }

    static getModule(name: string): ConfigModuleDef | undefined {
        return ConfigRegistry.modules.get(name)
    }

    static async describe(
        moduleName: string,
        userId?: string,
    ): Promise<{ key: string, value: unknown, sensitive: boolean }[]> {
        const data = await ConfigRegistry.get<Record<string, unknown>>(moduleName, userId)
        const mod = ConfigRegistry.modules.get(moduleName)
        const sensitiveKeys = mod?.sensitive ?? []
        return flattenForDisplay(data, '', sensitiveKeys)
    }

    // --- Internals ---

    private static requireSystemRepo(callerName: string): ISystemConfigRepo {
        if (!ConfigRegistry.systemRepo) {
            throw new Error(
                `ConfigRegistry.${callerName}: no system-config repo attached — ` +
                `register a storage middleware (e.g. MongoStorageMiddleware) and ConfigBootMiddleware before this call`,
            )
        }
        return ConfigRegistry.systemRepo
    }

    private static requireUserRepo(callerName: string): IUserConfigRepo {
        if (!ConfigRegistry.userRepo) {
            throw new Error(
                `ConfigRegistry.${callerName}: no user-config repo attached — ` +
                `register a storage middleware (e.g. MongoStorageMiddleware) and ConfigBootMiddleware before this call`,
            )
        }
        return ConfigRegistry.userRepo
    }

    private static coerceToRecord(value: unknown): Record<string, unknown> | null {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : null
    }
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
    const parts = path.split('.')
    let target = obj
    for (let i = 0; i < parts.length - 1; i++) {
        const next = target[parts[i]]
        if (next !== null && typeof next === 'object' && !Array.isArray(next)) {
            target = next as Record<string, unknown>
        } else {
            const fresh: Record<string, unknown> = {}
            target[parts[i]] = fresh
            target = fresh
        }
    }
    target[parts[parts.length - 1]] = value
}

function flattenForDisplay(
    obj: Record<string, unknown>, prefix: string, sensitiveKeys: string[],
): { key: string, value: unknown, sensitive: boolean }[] {
    const result: { key: string, value: unknown, sensitive: boolean }[] = []
    for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        const val = obj[key]
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            result.push(...flattenForDisplay(val as Record<string, unknown>, fullKey, sensitiveKeys))
        } else {
            const isSensitive = sensitiveKeys.some(s => fullKey.toLowerCase().includes(s.toLowerCase()))
                || ['token', 'key', 'secret', 'password', 'apikey', 'authtoken', 'credentials'].some(s => fullKey.toLowerCase().includes(s))
            result.push({ key: fullKey, value: val, sensitive: isSensitive })
        }
    }
    return result
}
