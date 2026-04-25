"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConfigRegistry = void 0;
const fs = __importStar(require("fs"));
const path_1 = require("./constants/path");
const validation_1 = require("./utils/validation");
const logger_1 = __importDefault(require("./application/logger"));
class ConfigRegistry {
    static modules = new Map();
    static bootstrapData = {};
    static bootstrapLoaded = false;
    static systemRepo = null;
    static userRepo = null;
    static register(module) {
        ConfigRegistry.modules.set(module.name, module);
    }
    static attachRepos(systemRepo, userRepo) {
        ConfigRegistry.systemRepo = systemRepo;
        ConfigRegistry.userRepo = userRepo;
    }
    static async seedSystemDefaults() {
        if (!ConfigRegistry.bootstrapLoaded)
            ConfigRegistry.loadBootstrap();
        const repo = ConfigRegistry.requireSystemRepo('seedSystemDefaults');
        for (const [name, mod] of ConfigRegistry.modules) {
            if (mod.scope === 'bootstrap')
                continue;
            const fromFile = ConfigRegistry.bootstrapData[name];
            const fromFileObj = ConfigRegistry.coerceToRecord(fromFile);
            const seed = fromFileObj && Object.keys(fromFileObj).length > 0
                ? { ...mod.defaults, ...fromFileObj }
                : { ...mod.defaults };
            const existing = await repo.findByModule(name);
            if (existing)
                continue;
            await repo.insertIfAbsent(name, seed);
            const tag = fromFileObj && Object.keys(fromFileObj).length > 0
                ? `migrated "${name}" from config.json`
                : `created "${name}" with defaults`;
            logger_1.default.info(`ConfigRegistry: ${tag} in system store`);
        }
    }
    static loadBootstrap() {
        try {
            const raw = JSON.parse(fs.readFileSync(path_1.main_config_path).toString());
            ConfigRegistry.bootstrapData = ConfigRegistry.coerceToRecord(raw) ?? {};
            ConfigRegistry.bootstrapLoaded = true;
        }
        catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            console.error(`ConfigRegistry: failed to load bootstrap config: ${message}`);
        }
    }
    static getBootstrap(moduleName) {
        if (!ConfigRegistry.bootstrapLoaded)
            ConfigRegistry.loadBootstrap();
        const mod = ConfigRegistry.modules.get(moduleName);
        const defaults = mod?.defaults ?? {};
        const fileSection = ConfigRegistry.coerceToRecord(ConfigRegistry.bootstrapData[moduleName]) ?? {};
        return { ...defaults, ...fileSection };
    }
    static async getSystem(moduleName) {
        const mod = ConfigRegistry.modules.get(moduleName);
        const defaults = mod?.defaults ?? {};
        if (!ConfigRegistry.systemRepo)
            return defaults;
        try {
            const doc = await ConfigRegistry.systemRepo.findByModule(moduleName);
            return { ...defaults, ...(doc?.data ?? {}) };
        }
        catch {
            return defaults;
        }
    }
    static async setSystem(moduleName, path, value) {
        if (!(0, validation_1.isValidConfigPath)(path))
            throw new Error(`Invalid config path: "${path}"`);
        const repo = ConfigRegistry.requireSystemRepo('setSystem');
        await repo.setPath(moduleName, path, value);
        const mod = ConfigRegistry.modules.get(moduleName);
        const isSensitive = mod?.sensitive?.some(s => path.toLowerCase().includes(s.toLowerCase())) ?? false;
        logger_1.default.trace(`ConfigRegistry: set system ${moduleName}.${path} = ${isSensitive ? '***' : JSON.stringify(value)}`);
    }
    static async clearSystem(moduleName) {
        const repo = ConfigRegistry.requireSystemRepo('clearSystem');
        await repo.clear(moduleName);
    }
    static async getUser(moduleName, userId) {
        const mod = ConfigRegistry.modules.get(moduleName);
        const defaults = mod?.defaults ?? {};
        if (!ConfigRegistry.systemRepo || !ConfigRegistry.userRepo)
            return defaults;
        try {
            const sysDoc = await ConfigRegistry.systemRepo.findByModule(moduleName);
            const userDoc = await ConfigRegistry.userRepo.findByUserAndModule(userId, moduleName);
            return { ...defaults, ...(sysDoc?.data ?? {}), ...(userDoc?.data ?? {}) };
        }
        catch {
            return defaults;
        }
    }
    static async setUser(moduleName, userId, path, value) {
        if (!(0, validation_1.isValidConfigPath)(path))
            throw new Error(`Invalid config path: "${path}"`);
        const repo = ConfigRegistry.requireUserRepo('setUser');
        await repo.setPath(userId, moduleName, path, value);
        const mod = ConfigRegistry.modules.get(moduleName);
        const isSensitive = mod?.sensitive?.some(s => path.toLowerCase().includes(s.toLowerCase())) ?? false;
        logger_1.default.trace(`ConfigRegistry: set user[${userId}] ${moduleName}.${path} = ${isSensitive ? '***' : JSON.stringify(value)}`);
    }
    static async clearUser(moduleName, userId) {
        const repo = ConfigRegistry.requireUserRepo('clearUser');
        await repo.clear(userId, moduleName);
    }
    static async get(moduleName, userId) {
        const mod = ConfigRegistry.modules.get(moduleName);
        if (!mod)
            return {};
        switch (mod.scope) {
            case 'bootstrap':
                return ConfigRegistry.getBootstrap(moduleName);
            case 'system':
                return ConfigRegistry.getSystem(moduleName);
            case 'user':
                if (userId)
                    return ConfigRegistry.getUser(moduleName, userId);
                return ConfigRegistry.getSystem(moduleName);
        }
    }
    static async set(moduleName, path, value, userId) {
        const mod = ConfigRegistry.modules.get(moduleName);
        if (!mod)
            throw new Error(`Config module "${moduleName}" not registered`);
        switch (mod.scope) {
            case 'bootstrap':
                if (!ConfigRegistry.bootstrapLoaded)
                    ConfigRegistry.loadBootstrap();
                setNestedValue(ConfigRegistry.bootstrapData, `${moduleName}.${path}`, value);
                fs.writeFileSync(path_1.main_config_path, JSON.stringify(ConfigRegistry.bootstrapData, null, '    '));
                break;
            case 'system':
                await ConfigRegistry.setSystem(moduleName, path, value);
                break;
            case 'user':
                if (userId) {
                    await ConfigRegistry.setUser(moduleName, userId, path, value);
                }
                else {
                    await ConfigRegistry.setSystem(moduleName, path, value);
                }
                break;
        }
    }
    static list() {
        return Array.from(ConfigRegistry.modules.keys());
    }
    static has(name) {
        return ConfigRegistry.modules.has(name);
    }
    static getModule(name) {
        return ConfigRegistry.modules.get(name);
    }
    static async describe(moduleName, userId) {
        const data = await ConfigRegistry.get(moduleName, userId);
        const mod = ConfigRegistry.modules.get(moduleName);
        const sensitiveKeys = mod?.sensitive ?? [];
        return flattenForDisplay(data, '', sensitiveKeys);
    }
    static requireSystemRepo(callerName) {
        if (!ConfigRegistry.systemRepo) {
            throw new Error(`ConfigRegistry.${callerName}: no system-config repo attached — ` +
                `register a storage middleware (e.g. MongoStorageMiddleware) and ConfigBootMiddleware before this call`);
        }
        return ConfigRegistry.systemRepo;
    }
    static requireUserRepo(callerName) {
        if (!ConfigRegistry.userRepo) {
            throw new Error(`ConfigRegistry.${callerName}: no user-config repo attached — ` +
                `register a storage middleware (e.g. MongoStorageMiddleware) and ConfigBootMiddleware before this call`);
        }
        return ConfigRegistry.userRepo;
    }
    static coerceToRecord(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value
            : null;
    }
}
exports.ConfigRegistry = ConfigRegistry;
function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let target = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        const next = target[parts[i]];
        if (next !== null && typeof next === 'object' && !Array.isArray(next)) {
            target = next;
        }
        else {
            const fresh = {};
            target[parts[i]] = fresh;
            target = fresh;
        }
    }
    target[parts[parts.length - 1]] = value;
}
function flattenForDisplay(obj, prefix, sensitiveKeys) {
    const result = [];
    for (const key of Object.keys(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const val = obj[key];
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            result.push(...flattenForDisplay(val, fullKey, sensitiveKeys));
        }
        else {
            const isSensitive = sensitiveKeys.some(s => fullKey.toLowerCase().includes(s.toLowerCase()))
                || ['token', 'key', 'secret', 'password', 'apikey', 'authtoken', 'credentials'].some(s => fullKey.toLowerCase().includes(s));
            result.push({ key: fullKey, value: val, sensitive: isSensitive });
        }
    }
    return result;
}
