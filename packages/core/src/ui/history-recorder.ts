import type { MessageHistoryInput } from '@cmd-hub/common'
import type { DispatcherRepos } from './command-processor/dispatcher'
import log from '../application/logger'

/**
 * Persists inbound chat messages to the appropriate manager's history. UIs
 * wrap this in their platform's "on message" hook (Telegraf `bot.on('message')`,
 * Express request handler, Socket.IO event, etc.) and just hand it the parsed
 * `MessageHistoryInput`.
 */
export class HistoryRecorder {
    constructor(private readonly repos: DispatcherRepos) {}

    /** Append to the history of the manager identified by `managerId`. No-op
     *  when no such manager exists. */
    async appendForManager(managerId: string, input: MessageHistoryInput): Promise<void> {
        const handle = await this.repos.manager.handleById(managerId)
        if (!handle) {
            log.debug(`HistoryRecorder.appendForManager: no manager ${managerId}`)
            return
        }
        await handle.appendMessage(input)
    }

    /** Append to the history of the manager whose `userId` equals `userIdLookup`.
     *  Used by the Telegram bot-echo path where the originating user isn't a
     *  manager but the chat-id resolves to one. */
    async appendForUserIdLookup(userIdLookup: string | number, input: MessageHistoryInput): Promise<void> {
        const handle = await this.repos.manager.handleByUserId(userIdLookup)
        if (!handle) {
            log.debug(`HistoryRecorder.appendForUserIdLookup: no manager for userId ${userIdLookup}`)
            return
        }
        await handle.appendMessage(input)
    }
}
