import { BaseUIContext } from "./types/context"
import { IUI } from "./types/ui"
import { PendingDelete } from "@core/db"
import log from "@logger"
import type { MessageType } from '@cmd-hub/common'

export type { MessageType }

interface TrackedMessage {
    messageId: string
    userId: string
    type: MessageType
    createdAt: number
    deleteAfter: number
    timer?: ReturnType<typeof setTimeout>
}

const DEFAULT_TTL: Record<MessageType, number | null> = {
    builder: null,     // event-driven: cleanup triggered when build completes
    dashboard: null,   // event-driven: cleanup triggered on detach
    system: 60_000,
    result: null,
}

export class MessageLifecycleManager<Ctx extends BaseUIContext> {
    private tracked = new Map<string, TrackedMessage[]>()
    private ttlConfig: Record<MessageType, number | null>

    constructor(
        private uiImpl: IUI<Ctx>,
        ttlOverrides?: Partial<Record<MessageType, number | null>>
    ) {
        this.ttlConfig = { ...DEFAULT_TTL, ...ttlOverrides }
    }

    /**
     * On startup: load pending deletes from DB, delete them, clear the collection
     */
    async restoreAndCleanup(): Promise<void> {
        try {
            const pending = await PendingDelete.find({})
            if (pending.length === 0) return

            log.info(`MessageLifecycle: restoring ${pending.length} pending deletes from previous session`)
            for (const doc of pending) {
                try {
                    await this.uiImpl.deleteMessage(doc.userId, doc.messageId)
                    log.trace(`MessageLifecycle: restored delete ${doc.type} message ${doc.messageId} for user ${doc.userId}`)
                } catch (_) {
                    log.debug(`MessageLifecycle: failed to restore delete ${doc.messageId} (may be too old)`)
                }
            }
            await PendingDelete.deleteMany({})
            log.info(`MessageLifecycle: restore complete, cleared pending deletes`)
        } catch (e: any) {
            log.debug(`MessageLifecycle: restore failed (DB may not be connected yet): ${e.message ?? e}`)
        }
    }

    track(userId: string, messageId: string, type: MessageType): void {
        if (type === 'result' && this.ttlConfig.result === null) {
            return
        }

        const now = Date.now()
        const ttl = this.ttlConfig[type]
        const deleteAfter = ttl !== null && ttl > 0 ? now + ttl : 0

        const entry: TrackedMessage = {
            messageId,
            userId,
            type,
            createdAt: now,
            deleteAfter,
        }

        const userMessages = this.tracked.get(userId) ?? []
        userMessages.push(entry)
        this.tracked.set(userId, userMessages)

        // Persist to DB for crash recovery
        this.persist(entry).catch(() => {})

        if (ttl !== null && ttl > 0) {
            entry.timer = setTimeout(() => {
                this.cleanup(userId, messageId).catch(() => {})
            }, ttl)
        }

        log.trace(`MessageLifecycle: tracked ${type} message ${messageId} for user ${userId}${ttl ? ` (TTL ${ttl}ms)` : ''}`)
    }

    async cleanup(userId: string, messageId: string): Promise<void> {
        const userMessages = this.tracked.get(userId)
        if (!userMessages) return

        const idx = userMessages.findIndex(m => m.messageId === messageId)
        if (idx === -1) return

        const msg = userMessages[idx]
        if (msg.timer) clearTimeout(msg.timer)
        userMessages.splice(idx, 1)

        // Remove from DB
        this.unpersist(userId, messageId).catch(() => {})

        try {
            await this.uiImpl.deleteMessage(userId, messageId)
            log.trace(`MessageLifecycle: deleted ${msg.type} message ${messageId} for user ${userId}`)
        } catch (_) {
            log.debug(`MessageLifecycle: failed to delete message ${messageId} (may be too old or already deleted)`)
        }
    }

    async cleanupByType(userId: string, type: MessageType): Promise<void> {
        const userMessages = this.tracked.get(userId)
        if (!userMessages) return

        const toDelete = userMessages.filter(m => m.type === type)
        for (const msg of toDelete) {
            await this.cleanup(userId, msg.messageId)
        }
    }

    scheduleCleanupByType(userId: string, type: MessageType, delayMs: number = 0): void {
        if (delayMs <= 0) {
            this.cleanupByType(userId, type).catch(() => {})
            return
        }
        setTimeout(() => {
            this.cleanupByType(userId, type).catch(() => {})
        }, delayMs)
    }

    async cleanupAll(userId: string): Promise<void> {
        const userMessages = this.tracked.get(userId)
        if (!userMessages) return

        const copy = [...userMessages]
        for (const msg of copy) {
            await this.cleanup(userId, msg.messageId)
        }
        this.tracked.delete(userId)
    }

    /**
     * Persist all currently tracked messages to DB (call before shutdown)
     */
    async persistAll(): Promise<void> {
        let count = 0
        for (const [_, messages] of this.tracked) {
            for (const msg of messages) {
                await this.persist(msg)
                count++
            }
        }
        if (count > 0) {
            log.info(`MessageLifecycle: persisted ${count} pending deletes for next startup`)
        }
    }

    setTTL(type: MessageType, ttlMs: number | null): void {
        this.ttlConfig[type] = ttlMs
    }

    getTTL(type: MessageType): number | null {
        return this.ttlConfig[type]
    }

    getTracked(userId: string): ReadonlyArray<TrackedMessage> {
        return this.tracked.get(userId) ?? []
    }

    private async persist(msg: TrackedMessage): Promise<void> {
        try {
            await PendingDelete.updateOne(
                { userId: msg.userId, messageId: msg.messageId },
                {
                    userId: msg.userId,
                    messageId: msg.messageId,
                    type: msg.type,
                    createdAt: msg.createdAt,
                    deleteAfter: msg.deleteAfter || Date.now(),
                },
                { upsert: true }
            )
        } catch (_) {
            log.debug(`MessageLifecycle: failed to persist message ${msg.messageId}`)
        }
    }

    private async unpersist(userId: string, messageId: string): Promise<void> {
        try {
            await PendingDelete.deleteOne({ userId, messageId })
        } catch (_) {
            log.debug(`MessageLifecycle: failed to unpersist message ${messageId}`)
        }
    }
}
