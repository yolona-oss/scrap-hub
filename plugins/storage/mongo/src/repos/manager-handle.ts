import type {
    IManagerHandle,
    ManagerRecord,
    MessageHistoryEntry,
    MessageHistoryInput,
} from '@cmd-hub/common'
import { ManagerModel, type ManagerHydrated } from '../models/manager.model'
import { MsgHistoryModel } from '../models/messages-history.model'

/** Convert a hydrated ManagerDoc to the driver-agnostic record. */
export function managerDocToRecord(doc: ManagerHydrated): ManagerRecord {
    return {
        id: doc._id.toHexString(),
        userId: doc.userId,
        name: doc.name,
        isAdmin: doc.isAdmin ?? false,
        online: doc.online ?? false,
        accountId: doc.account ? doc.account.toHexString() : null,
        useGreeting: doc.useGreeting ?? true,
        messageWidth: doc.messageWidth ?? null,
        passwordHash: doc.passwordHash ?? null,
    }
}

/** Concrete `IManagerHandle`. Holds onto a hydrated mongoose document so
 *  message-history mutations can call into MsgHistoryModel directly. */
export class MongoManagerHandle implements IManagerHandle {
    constructor(private readonly doc: ManagerHydrated) {}

    get record(): ManagerRecord {
        return managerDocToRecord(this.doc)
    }

    async getMessagesHistory(): Promise<MessageHistoryEntry[]> {
        const docs = await MsgHistoryModel.find({ userId: this.doc.userId }).lean()
        return docs.map((d): MessageHistoryEntry => ({
            chatId: d.chatId,
            userId: d.userId,
            messageId: d.message_id,
            text: d.text,
            isEdited: d.isEdited ?? false,
            timestamp: d.timestamp ?? null,
        }))
    }

    async appendMessage(input: MessageHistoryInput): Promise<void> {
        const msg = await MsgHistoryModel.create({
            chatId:     input.chatId,
            userId:     input.userId,
            message_id: input.messageId ?? -1,
            text:       input.text,
            isEdited:   input.isEdited ?? false,
            timestamp:  normaliseTimestamp(input.timestamp),
        })
        await msg.save()
    }

    async editMessage(input: MessageHistoryInput): Promise<void> {
        await MsgHistoryModel.updateOne(
            { message_id: input.messageId, userId: input.userId },
            {
                chatId:     input.chatId,
                userId:     input.userId,
                message_id: input.messageId,
                text:       input.text,
                isEdited:   true,
                timestamp:  normaliseTimestamp(input.timestamp),
            },
        )
    }

    async deleteMessage(messageId: number): Promise<void> {
        await MsgHistoryModel.deleteOne({ message_id: messageId, userId: this.doc.userId })
    }
}

/** Some upstream callers pass timestamps in seconds. We accept either and
 *  always emit a Date. */
function normaliseTimestamp(input: number | undefined): Date | undefined {
    if (input === undefined) return undefined
    const digits = input.toString().length
    const jsDigits = Date.now().toString().length
    const diff = jsDigits - digits
    const ms = diff > 0 ? input * 10 ** diff : input
    return new Date(ms)
}

export { ManagerModel }
