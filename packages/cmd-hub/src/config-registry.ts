import * as fs from 'fs'
import { main_config_path } from './constants/path'
import { isValidConfigPath } from './utils/validation'

// Lazy logger to avoid circular dependency (logger → config → config-registry → logger)
function getLog() {
    return require('@logger').default ?? require('@logger')
}

// Lazy DB imports to avoid circular dependency (db → config → config-registry → db)
function getSystemConfigModel() {
    return require('@core/db').SystemConfig
}
function getUserConfigModel() {
    return require('@core/db').UserConfig
}

export type ConfigScope = 'bootstrap' | 'system' | 'user'

export interface ConfigModuleDef {
    name: string
    defaults: Record<string, any>
    sensitive?: string[]
    scope: ConfigScope
}

export class ConfigRegistry {
    private static modules = new Map<string, ConfigModuleDef>()
    private static bootstrapData: Record<string, any> = {}
    private static bootstrapLoaded = false

    static register(module: ConfigModuleDef): void {
        ConfigRegistry.modules.set(module.name, module)
        // Don't log here — register() is called at module-load time before logger is ready
    }

    // --- Bootstrap (config.json, sync, before DB) ---

    static loadBootstrap(): void {
        try {
            ConfigRegistry.bootstrapData = JSON.parse(fs.readFileSync(main_config_path).toString())
            ConfigRegistry.bootstrapLoaded = true
        } catch (e: any) {
            console.error(`ConfigRegistry: failed to load bootstrap config: ${e.message ?? e}`)
        }
    }

    static getBootstrap<T = any>(moduleName: string): T {
        if (!ConfigRegistry.bootstrapLoaded) ConfigRegistry.loadBootstrap()
        const mod = ConfigRegistry.modules.get(moduleName)
        const defaults = mod?.defaults ?? {}
        return { ...defaults, ...(ConfigRegistry.bootstrapData[moduleName] ?? {}) } as T
    }

    // --- System config (MongoDB, shared) ---

    static async getSystem<T = any>(moduleName: string): Promise<T> {
        const mod = ConfigRegistry.modules.get(moduleName)
        const defaults = mod?.defaults ?? {}
        try {
            const doc = await getSystemConfigModel().findOne({ module: moduleName })
            return { ...defaults, ...(doc?.data ?? {}) } as T
        } catch (_) {
            return defaults as T
        }
    }

    static async setSystem(moduleName: string, path: string, value: any): Promise<void> {
        if (!isValidConfigPath(path)) throw new Error(`Invalid config path: "${path}"`)
        await getSystemConfigModel().findOneAndUpdate(
            { module: moduleName },
            { $set: { [`data.${path}`]: value } },
            { upsert: true, new: true }
        )
        const mod = ConfigRegistry.modules.get(moduleName)
        const isSensitive = mod?.sensitive?.some(s => path.toLowerCase().includes(s.toLowerCase()))
        getLog().trace(`ConfigRegistry: set system ${moduleName}.${path} = ${isSensitive ? '***' : JSON.stringify(value)}`)
    }

    static async clearSystem(moduleName: string): Promise<void> {
        await getSystemConfigModel().findOneAndUpdate(
            { module: moduleName },
            { $set: { data: {} } },
            { upsert: true }
        )
    }

    // --- User config (MongoDB, per-user) ---

    static async getUser<T = any>(moduleName: string, userId: string): Promise<T> {
        const mod = ConfigRegistry.modules.get(moduleName)
        const defaults = mod?.defaults ?? {}
        try {
            const sysDoc = await getSystemConfigModel().findOne({ module: moduleName })
            const userDoc = await getUserConfigModel().findOne({ userId, module: moduleName })
            // Priority: user > system > defaults
            return { ...defaults, ...(sysDoc?.data ?? {}), ...(userDoc?.data ?? {}) } as T
        } catch (_) {
            return defaults as T
        }
    }

    static async setUser(moduleName: string, userId: string, path: string, value: any): Promise<void> {
        if (!isValidConfigPath(path)) throw new Error(`Invalid config path: "${path}"`)
        await getUserConfigModel().findOneAndUpdate(
            { userId, module: moduleName },
            { $set: { [`data.${path}`]: value } },
            { upsert: true, new: true }
        )
        const mod = ConfigRegistry.modules.get(moduleName)
        const isSensitive = mod?.sensitive?.some(s => path.toLowerCase().includes(s.toLowerCase()))
        getLog().trace(`ConfigRegistry: set user[${userId}] ${moduleName}.${path} = ${isSensitive ? '***' : JSON.stringify(value)}`)
    }

    static async clearUser(moduleName: string, userId: string): Promise<void> {
        await getUserConfigModel().findOneAndUpdate(
            { userId, module: moduleName },
            { $set: { data: {} } },
            { upsert: true }
        )
    }

    // --- Unified get (respects scope) ---

    static async get<T = any>(moduleName: string, userId?: string): Promise<T> {
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

    // --- Unified set (respects scope) ---

    static async set(moduleName: string, path: string, value: any, userId?: string): Promise<void> {
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

    // --- Migrate config.json non-bootstrap sections to MongoDB (first run) ---

    static async migrateToMongoDB(): Promise<void> {
        if (!ConfigRegistry.bootstrapLoaded) ConfigRegistry.loadBootstrap()

        for (const [name, mod] of ConfigRegistry.modules) {
            if (mod.scope === 'bootstrap') continue

            const existing = await getSystemConfigModel().findOne({ module: name })
            if (!existing) {
                const fromFile = ConfigRegistry.bootstrapData[name]
                if (fromFile && Object.keys(fromFile).length > 0) {
                    await getSystemConfigModel().create({ module: name, data: { ...mod.defaults, ...fromFile } })
                    getLog().info(`ConfigRegistry: migrated "${name}" from config.json to MongoDB`)
                } else {
                    await getSystemConfigModel().create({ module: name, data: mod.defaults })
                    getLog().info(`ConfigRegistry: created "${name}" with defaults in MongoDB`)
                }
            }
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

    static async describe(moduleName: string, userId?: string): Promise<{ key: string, value: any, sensitive: boolean }[]> {
        const data = await ConfigRegistry.get(moduleName, userId)
        const mod = ConfigRegistry.modules.get(moduleName)
        const sensitiveKeys = mod?.sensitive ?? []
        return flattenForDisplay(data as any, '', sensitiveKeys)
    }
}

function setNestedValue(obj: any, path: string, value: any): void {
    const parts = path.split('.')
    let target = obj
    for (let i = 0; i < parts.length - 1; i++) {
        if (!target[parts[i]] || typeof target[parts[i]] !== 'object') {
            target[parts[i]] = {}
        }
        target = target[parts[i]]
    }
    target[parts[parts.length - 1]] = value
}

function flattenForDisplay(
    obj: any, prefix: string, sensitiveKeys: string[]
): { key: string, value: any, sensitive: boolean }[] {
    const result: { key: string, value: any, sensitive: boolean }[] = []
    for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        const val = obj[key]
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            result.push(...flattenForDisplay(val, fullKey, sensitiveKeys))
        } else {
            const isSensitive = sensitiveKeys.some(s => fullKey.toLowerCase().includes(s.toLowerCase()))
                || ['token', 'key', 'secret', 'password', 'apikey', 'authtoken', 'credentials'].some(s => fullKey.toLowerCase().includes(s))
            result.push({ key: fullKey, value: val, sensitive: isSensitive })
        }
    }
    return result
}
