"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MessageLifecycleManager = void 0;
const logger_1 = __importDefault(require("../application/logger"));
const DEFAULT_TTL = {
    builder: null,
    dashboard: null,
    system: 60_000,
    result: null,
};
class MessageLifecycleManager {
    uiImpl;
    tracked = new Map();
    ttlConfig;
    repo = null;
    constructor(uiImpl, ttlOverrides) {
        this.uiImpl = uiImpl;
        this.ttlConfig = { ...DEFAULT_TTL, ...ttlOverrides };
    }
    attachRepo(repo) {
        this.repo = repo;
    }
    async restoreAndCleanup() {
        if (!this.repo)
            return;
        try {
            const pending = await this.repo.list();
            if (pending.length === 0)
                return;
            logger_1.default.info(`MessageLifecycle: restoring ${pending.length} pending deletes from previous session`);
            for (const doc of pending) {
                try {
                    await this.uiImpl.deleteMessage(doc.userId, doc.messageId);
                    logger_1.default.trace(`MessageLifecycle: restored delete ${doc.type} message ${doc.messageId} for user ${doc.userId}`);
                }
                catch (_) {
                    logger_1.default.debug(`MessageLifecycle: failed to restore delete ${doc.messageId} (may be too old)`);
                }
            }
            await this.repo.deleteAll();
            logger_1.default.info(`MessageLifecycle: restore complete, cleared pending deletes`);
        }
        catch (e) {
            const message = e?.message ?? String(e);
            logger_1.default.debug(`MessageLifecycle: restore failed (DB may not be connected yet): ${message}`);
        }
    }
    track(userId, messageId, type) {
        if (type === 'result' && this.ttlConfig.result === null) {
            return;
        }
        const now = Date.now();
        const ttl = this.ttlConfig[type];
        const deleteAfter = ttl !== null && ttl > 0 ? now + ttl : 0;
        const entry = {
            messageId,
            userId,
            type,
            createdAt: now,
            deleteAfter,
        };
        const userMessages = this.tracked.get(userId) ?? [];
        userMessages.push(entry);
        this.tracked.set(userId, userMessages);
        this.persist(entry).catch(() => { });
        if (ttl !== null && ttl > 0) {
            entry.timer = setTimeout(() => {
                this.cleanup(userId, messageId).catch(() => { });
            }, ttl);
        }
        logger_1.default.trace(`MessageLifecycle: tracked ${type} message ${messageId} for user ${userId}${ttl ? ` (TTL ${ttl}ms)` : ''}`);
    }
    async cleanup(userId, messageId) {
        const userMessages = this.tracked.get(userId);
        if (!userMessages)
            return;
        const idx = userMessages.findIndex(m => m.messageId === messageId);
        if (idx === -1)
            return;
        const msg = userMessages[idx];
        if (msg.timer)
            clearTimeout(msg.timer);
        userMessages.splice(idx, 1);
        this.unpersist(userId, messageId).catch(() => { });
        try {
            await this.uiImpl.deleteMessage(userId, messageId);
            logger_1.default.trace(`MessageLifecycle: deleted ${msg.type} message ${messageId} for user ${userId}`);
        }
        catch (_) {
            logger_1.default.debug(`MessageLifecycle: failed to delete message ${messageId} (may be too old or already deleted)`);
        }
    }
    async cleanupByType(userId, type) {
        const userMessages = this.tracked.get(userId);
        if (!userMessages)
            return;
        const toDelete = userMessages.filter(m => m.type === type);
        for (const msg of toDelete) {
            await this.cleanup(userId, msg.messageId);
        }
    }
    scheduleCleanupByType(userId, type, delayMs = 0) {
        if (delayMs <= 0) {
            this.cleanupByType(userId, type).catch(() => { });
            return;
        }
        setTimeout(() => {
            this.cleanupByType(userId, type).catch(() => { });
        }, delayMs);
    }
    async cleanupAll(userId) {
        const userMessages = this.tracked.get(userId);
        if (!userMessages)
            return;
        const copy = [...userMessages];
        for (const msg of copy) {
            await this.cleanup(userId, msg.messageId);
        }
        this.tracked.delete(userId);
    }
    async persistAll() {
        if (!this.repo)
            return;
        let count = 0;
        for (const [, messages] of this.tracked) {
            for (const msg of messages) {
                await this.persist(msg);
                count++;
            }
        }
        if (count > 0) {
            logger_1.default.info(`MessageLifecycle: persisted ${count} pending deletes for next startup`);
        }
    }
    setTTL(type, ttlMs) {
        this.ttlConfig[type] = ttlMs;
    }
    getTTL(type) {
        return this.ttlConfig[type];
    }
    getTracked(userId) {
        return this.tracked.get(userId) ?? [];
    }
    async persist(msg) {
        if (!this.repo)
            return;
        try {
            await this.repo.upsert({
                userId: msg.userId,
                messageId: msg.messageId,
                type: msg.type,
                createdAt: msg.createdAt,
                deleteAfter: msg.deleteAfter || Date.now(),
            });
        }
        catch (_) {
            logger_1.default.debug(`MessageLifecycle: failed to persist message ${msg.messageId}`);
        }
    }
    async unpersist(userId, messageId) {
        if (!this.repo)
            return;
        try {
            await this.repo.deleteOne(userId, messageId);
        }
        catch (_) {
            logger_1.default.debug(`MessageLifecycle: failed to unpersist message ${messageId}`);
        }
    }
}
exports.MessageLifecycleManager = MessageLifecycleManager;
