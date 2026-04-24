import { getConfig, getInitialConfig } from '@cmd-hub/core'
import { BaseUI } from '@cmd-hub/core'
import { MessageType } from '@cmd-hub/core'
import { FilesWrapper, Manager } from '@cmd-hub/core'

import { TelegramUI_BuiltIns, toRegister } from './constants/commands'
import { TgContext } from "./types"
import { ITelegramPlugin } from './types/plugin'

import { LockManager } from '@cmd-hub/core'
import { log } from '@cmd-hub/common'

import crypto from 'crypto'
import * as telegraf from 'telegraf'
import chalk from 'chalk'
import { anyToString } from '@cmd-hub/core'
import { IUICommandProcessed } from '@cmd-hub/core'
import { InlineKeyboardButton } from 'telegraf/typings/core/types/typegram'
import { UiUnicodeSymbols, handleCalibrationCallback } from '@cmd-hub/core'
import type { IMsgHistoryDto, MessageOptions } from '@cmd-hub/core'
import { z } from 'zod'
import { readConfigSlice, type AppLike } from '@cmd-hub/common'

/** Telegram-specific adapter: turn a TgContext into the common
 *  message-history DTO. Inlined here because cmd-hub's db schema
 *  shouldn't know about telegram context shapes. */
function fromTgContext(ctx: TgContext): IMsgHistoryDto {
    return {
        chatId: ctx.chat!.id,
        userId: ctx.from!.id,
        text: ctx.text ?? "",
        message_id: ctx.message!.message_id,
    }
}

import { CmdDispatcher, IHandleResult } from '@cmd-hub/core'
import { IBaseMarkup, IMarkupOption } from '@cmd-hub/core'

import {
    auth_cb_prefix
} from './constants/callback'

import {
    rejectJoinRequest,
    sendJoinRequestToAdmin,
    approveJoinRequest
} from './actions/auth'


export class TelegramUI extends BaseUI<TgContext> {
    static UserIdFromCtx(ctx: TgContext): string {
        const id = String(ctx.manager.userId)
        if (!id || id.length == 0) {
            throw new Error(`${this.caller.name}:=>:${this.name }: Cannot get user id from ctx: ${JSON.stringify(ctx, null, 2)}`)
        }
        return id
    }

    public bot!: telegraf.Telegraf<TgContext>
    public dispatcher!: CmdDispatcher<TgContext>
    private isActive: boolean = false

    /** ConfigContributor fields — CmdHubApp merges this slice into the
     *  merged app schema, so `config.telegram.{botToken,adminUserIds}` is
     *  validated at Initialize() before onAppAttach() fires. */
    readonly namespace = 'telegram' as const
    readonly schema = z.object({
        botToken: z.string().min(1),
        adminUserIds: z.array(z.union([z.string(), z.number()])).default([]),
    })

    /**
     * Parameterless: token comes from `config.telegram.botToken` (validated
     * by the contributor schema above); the dispatcher is attached during
     * `onAppAttach(app)` by `CmdHubApp.run()`.
     *
     * Back-compat: the old signature `new TelegramUI(botToken, dispatcher)`
     * still works. Pass both eagerly if you're bootstrapping without
     * CmdHubApp.
     */
    constructor(
        botToken?: string,
        dispatcher?: CmdDispatcher<TgContext>,
    ) {
        super()
        if (botToken) {
            this.bot = new telegraf.Telegraf<TgContext>(botToken)
        }
        if (dispatcher) {
            this.dispatcher = dispatcher
        }
    }

    /**
     * Called by CmdHubApp during run(). Lazy-initializes the Telegraf bot
     * from config.telegram.botToken and the CmdDispatcher (every UI owns
     * its own dispatcher; they don't share one).
     */
    async onAppAttach(app: AppLike): Promise<void> {
        if (!this.bot) {
            const cfg = readConfigSlice(app, this)
            this.bot = new telegraf.Telegraf<TgContext>(cfg.botToken)
        }
        if (!this.dispatcher) {
            this.dispatcher = new CmdDispatcher<TgContext>()
        }
    }

    max_message_width() {
        //return 48 // at slim screen
        return 72 // at wide screen
    }

    // Platform-specific implementations for BaseUI

    protected async sendMessageImpl(user_id: string, message: string, mk_opts?: IMarkupOption[], options?: MessageOptions): Promise<string> {
        const extra: any = {}
        if (mk_opts) {
            extra.reply_markup = { inline_keyboard: this.createCommonKeyboard(mk_opts) }
        }
        if (options?.parseMode) {
            extra.parse_mode = options.parseMode
        }
        return String((await this.bot.telegram.sendMessage(user_id, message, Object.keys(extra).length > 0 ? extra : undefined)).message_id)
    }

    protected async editMessageImpl(user_id: string, message_id: string, message: string, mk_opts?: IMarkupOption[], options?: MessageOptions): Promise<void> {
        const extra: any = {}
        if (mk_opts) {
            extra.reply_markup = { inline_keyboard: this.createCommonKeyboard(mk_opts) }
        }
        if (options?.parseMode) {
            extra.parse_mode = options.parseMode
        }
        await this.bot.telegram.editMessageText(user_id, Number(message_id), undefined, message, Object.keys(extra).length > 0 ? extra : undefined)
    }

    protected async deleteMessageImpl(user_id: string, message_id: string): Promise<void> {
        await this.bot.telegram.deleteMessage(user_id, Number(message_id))
    }

    private setCommandHandler(commands: IUICommandProcessed[]) {
        commands.forEach(cmd => {
            log.info(`-- Assigning command: "${chalk.bold(cmd.command)}"`)
            this.bot.command(cmd.command, async (ctx) => {
                await this.handleInput(cmd.command, ctx.text, ctx)
            })
        })
    }

    private async setupActions() {
        // bot auth algorithm actions
        this.bot.action(RegExp(auth_cb_prefix.directJoinRequestToAdmin + "*"), (ctx, next) => sendJoinRequestToAdmin.call(this, ctx, next))
        this.bot.action(RegExp(auth_cb_prefix.approveJoinRequest + "*"),       (ctx, next) => approveJoinRequest.call(this, ctx, next))
        this.bot.action(RegExp(auth_cb_prefix.rejectJoinRequest + "*"),        (ctx, next) => rejectJoinRequest.call(this, ctx, next))

        this.bot.action(RegExp('dashboard_*'), async (ctx) => {
            const action = String(ctx.match.input.slice('msg_bonder_'.length))

            const res = await this.dispatcher.handleCommand(action, action, ctx as any, this)
            await this.replyByCommandResult(ctx as any, res)
            await ctx.deleteMessage()
        })

        // handle calibration buttons
        this.bot.action(RegExp("calibrate_*"), async (ctx) => {
            const width = parseInt(ctx.match.input.slice("calibrate_".length))
            if (!isNaN(width)) {
                const result = await handleCalibrationCallback(ctx.from!.id, width)
                await ctx.answerCbQuery(result)
                await ctx.deleteMessage()
            }
        })

        // handle dashboard buttons
        this.bot.action(RegExp("svc_dash_*"), async (ctx) => {
            const action = ctx.match.input.slice("svc_dash_".length)
            const userId = String(ctx.from!.id)
            // Find the dashboard that owns this callback
            const activeServices = this.dispatcher.UserActiveServices(userId)
            for (const svc of activeServices) {
                const dashboard = this.dispatcher.getDashboard(userId, svc.name)
                if (dashboard) {
                    await dashboard.handleCallback(action)
                    await ctx.answerCbQuery()
                    return
                }
            }
            await ctx.answerCbQuery('Dashboard not found')
        })

        // handle builder buttons
        this.bot.action(RegExp("builder_*"), async (ctx) => {
            const action = String(ctx.match.input.slice("builder_".length))
            const res = await this.dispatcher.handleCommand(action, action, ctx as any, this)
            await this.replyByCommandResult(ctx as any, res)
        })

        // Plugin actions
        for (const p of this.plugins) {
            const tp = p as ITelegramPlugin
            if (tp.setupActions) {
                tp.setupActions(this.bot)
            }
        }
    }

    private setByTextCmdHandler() {
        this.bot.on('message', async (ctx, next) => {
            const firstWord = ctx.text?.split(" ")[0]
            const fullText = ctx.text ? ctx.text : ""
            const asCommand = firstWord?.slice(1) ?? ""
            const isCommandAlike = firstWord && firstWord.startsWith("/")

            // Track user's input message for cleanup:
            // - builder input (value entry) → 'builder' (cleaned when build completes)
            // - non-command text (unrecognized) → 'system' (cleaned after TTL)
            // - command input → not tracked (produces a result the user keeps)
            const userId = String(ctx.from?.id ?? '')
            const userMsgId = ctx.message?.message_id
            if (userId && userMsgId) {
                const isOnBuild = this.dispatcher.CommandBuilder.isUserOnBuild(userId)
                if (isOnBuild) {
                    this.lifecycle.track(userId, String(userMsgId), 'builder')
                } else if (!isCommandAlike) {
                    this.lifecycle.track(userId, String(userMsgId), 'system')
                }
            }

            await this.handleInput(isCommandAlike ? asCommand : fullText, fullText, ctx as TgContext)

            if (next) {
                return await next()
            }
        })
    }

    private async setupCommands() {
        if (this.isInitialized()) {
            throw new Error("TelegemUI::init() already inited")
        }

        if (!this.dispatcher.isInitialized()) {
            throw new Error("TelegemUI::init() command handler not inited")
        }

        // apply builtin tg commands to cmd handler
        const tgCommands = this.registerTgComands()
        const commands = this.dispatcher.toUICommands().concat(tgCommands.map(cmd => cmd.command) as IUICommandProcessed[])

        this.verifyCommands(commands)
        log.info(`Commands verified ${chalk.green("successfully")}. Total commands: ${chalk.bold(commands.length)}`)

        this.setCommandHandler(commands)
        this.setByTextCmdHandler()

        // Plugin commands
        for (const p of this.plugins) {
            const tp = p as ITelegramPlugin
            if (tp.setupCommands) {
                tp.setupCommands(this.bot)
            }
        }

        // assign to autocomplete
        await this.bot.telegram.setMyCommands(commands)

        this.setInitialized()
    }

    private async setupAuth() {
        // Authorization
        this.bot.use(async (ctx, next) => {
            const manager = await Manager.findOne({ userId: ctx.from!.id })
            if (manager) {
                ctx.type = 'telegram'
                ctx.manager = manager
                return await next()
            } else if (ctx.updateType == 'callback_query') {
                //@ts-ignore
                if (ctx.update.callback_query.data.includes(auth_cb_prefix.directJoinRequestToAdmin)) {
                    return next()
                }
            }
            const botName = (await getConfig()).bot.name
            const sent = await ctx.replyWithMarkdownV2(`Welcome to ${botName}. To start using bot you need to be aproved by bot administrator.\n" +
"Click on button for send approve request`,
                telegraf.Markup.inlineKeyboard([ [ { text: "Send", callback_data: auth_cb_prefix.directJoinRequestToAdmin + " " + ctx.from!.id  }, ] ]))
            this.lifecycle.track(String(ctx.from!.id), String(sent.message_id), 'system')
        })
    }

    private async setupHistorySave() {
        this.bot.on('message', async function(ctx, next) {
            if (ctx.manager) {
                const manager = await Manager.findById(ctx.manager.id)
                if (manager) {
                    await manager.appendMessageHistory(fromTgContext(ctx as TgContext))
                }
            } else if (ctx.message.from.is_bot) {
                // TODO be pretty to use OPC :>
                const manager = await Manager.findById(ctx.chat.id)
                if (manager) {
                    await manager.appendMessageHistory({
                        chatId: ctx.chat!.id,
                        userId: manager.userId,
                        message_id: ctx.message?.message_id,
                        text: ctx.text ?? "",
                        timestamp: ctx.message?.date ? ctx.message.date : undefined
                    })
                }
            } else {
                log.debug(`No manager in ctx for saving message history. user: ${ctx.from?.id}, chat: ${ctx.chat?.id}, message: ${ctx.message?.message_id}`)
            }
            return await next()
        })

        this.bot.on('edited_message', async function(ctx, next) {
            const mamanger = await Manager.findById(ctx.manager.id)
            if (mamanger) {
                await mamanger.appendMessageHistory(fromTgContext(ctx as TgContext))
            } else {
                log.debug(`No manager in ctx for editing history message. user: ${ctx.from?.id}, chat: ${ctx.chat?.id}`)
            }
            if (next) {
                return await next()
            }
        })
    }

    private async setup() {
        await this.setupAuth()

        // Plugin middleware (after auth, before history/commands)
        for (const p of this.plugins) {
            const tp = p as ITelegramPlugin
            if (tp.setupMiddleware) {
                tp.setupMiddleware(this.bot)
            }
        }

        await this.setupHistorySave()
        await this.setupCommands()
        await this.setupActions()

        // Plugin lifecycle init
        await this.initPlugins()
    }

    async run() {
        await this.setup()

        if (!super.isInitialized()) {
            throw new Error("TelegemUI::run() not inited")
        }

        const Config = await getConfig()

        if (this.isActive) {
            throw new Error("TelegemUI::run() already running")
        }

        try {
            let adminExisted = true
            let admin = await Manager.findOne({ userId: Config.bot.admin_id })
            if (!admin) {
                log.info("Creating admin...")
                adminExisted = false
                const defaultAvatar = await FilesWrapper.getDefaultAvatar()
                if (!defaultAvatar) {
                    throw new Error("TelegemUI::run() default avatar not found")
                }
                await Manager.create({
                    isAdmin: true,
                    name: "Admin",
                    userId: Config.bot.admin_id,
                    online: false,
                    avatar: defaultAvatar.id,
                    useGreeting: true
                })
            }
            log.info("Starting Telegram-bot service...")
            this.bot.launch(() => {
                log.info("Telegram-bot service launched!")
            })
            if (adminExisted) {
                log.info("Sending welcome message to admins...")
                for (let manager of await Manager.find()) {
                    if (!manager.useGreeting) {
                        continue
                    }
                    try {
                        await this.notifyManagers(manager.userId, `${UiUnicodeSymbols.info} Service now online`)
                    } catch (e: any) {
                        log.warn(`Failed to send startup greeting to manager ${manager.userId}: ${e.message ?? e}`)
                    }
                }
            }
            log.info("** Telegram-bot service started")
        } catch(e) {
            throw new Error("TelegemUI::run() " + e)
        }

        const self = this
        this.bot.catch(async function(err, ctx) {
            const sent = await ctx.reply(`${UiUnicodeSymbols.error} Internall tg-service error:\n -- ${anyToString(err)}`)
            self.lifecycle.track(String(ctx.from?.id ?? ''), String(sent.message_id), 'system')
        })

        // Restore and cleanup messages from previous session
        await this.lifecycle.restoreAndCleanup()

        this.isActive = true
    }

    async terminate() {
        if (!this.isRunning()) {
            throw new Error("TelegemUI::terminate() not running")
        }

        this.isActive = false

        // Persist pending deletes for next startup
        await this.lifecycle.persistAll()
        await Manager.updateMany({ online: true }, { online: false })
        let managers = await Manager.find()
        for (let manager of managers) {
            if (!manager.useGreeting) { continue }
            try {
                await this.notifyManagers(manager.userId, `${UiUnicodeSymbols.info} Service going offline`)
            } catch (e: any) {
                log.warn(`Failed to send shutdown greeting to manager ${manager.userId}: ${e.message ?? e}`)
            }
        }
        await this.terminatePlugins()
        await this.dispatcher.stopAllServices()
        this.bot.stop()
        log.info("** Telegram ui stopped")
    }

    // Append builtin telegram command to command handler

    private registerTgComands() {
        const commands = TelegramUI_BuiltIns.map(toRegister)
        commands.forEach((c) => this.dispatcher.unBoundRegister(c)) // why dont work? commands.forEach(this.dispatcher.unBoundRegister)
        return commands
    }

    // VV UTILITY VV

    /**
     * Send a message through the bot API with lifecycle tracking.
     * Use this instead of direct ctx.reply() for tracked message sends.
     */
    async trackedSend(userId: string | number, text: string, type: MessageType = 'system'): Promise<string> {
        const sent = await this.bot.telegram.sendMessage(userId, text)
        const msgId = String(sent.message_id)
        this.lifecycle.track(String(userId), msgId, type)
        return msgId
    }

    private async notifyManagers(id: string|number, msg: string, stiker?: string) {
        await this.trackedSend(id, msg, 'system')
        if (stiker) {
            try {
                await this.bot.telegram.sendSticker(id, stiker)
            } catch (e: any) {
                log.debug(`Failed to send sticker to ${id}: ${e.message ?? e}`)
            }
        }
    }

    private verifyCommands(commands: { command: string, description: string }[]) {
        const maxCmdLength = 32
        const maxDescLength = 256
        const CmdAllowedSymbols = "A-Za-z0-9_"
        const commandList = commands.map(cmd => cmd.command)
        const descriptionList = commands.map(cmd => cmd.description)

        for (const cmd of commandList) {
            if (cmd.length > maxCmdLength) {
                throw new Error(`Command "${cmd}" is too long. Max length is ${maxCmdLength}, command length is ${cmd.length}`)
            }
            if (cmd.match(new RegExp(`[^${CmdAllowedSymbols}]`))) {
                throw new Error(`Command "${cmd}" contains invalid symbols`)
            }
        }

        let i = 0
        for (const desc of descriptionList) {
            if (desc.length > maxDescLength) {
                throw new Error(`Description of command "${commandList[i]}" "${desc}" is too long. Max length is ${maxDescLength}, description length is ${desc.length}`)
            }
            i++
        }
    }

    // Commands handlers utility

    private createCommonKeyboard(btns: IMarkupOption[], perLine = 3) {
        let arr: Array<Array<InlineKeyboardButton>> = []

        // Group buttons by type — each type starts on a new row
        const groups: Map<string, IMarkupOption[]> = new Map()
        for (const btn of btns) {
            const group = groups.get(btn.type) ?? []
            group.push(btn)
            groups.set(btn.type, group)
        }

        for (const [_, group] of groups) {
            for (let i = 0; i < group.length; i += perLine) {
                arr.push(group.slice(i, i + perLine).map(m => telegraf.Markup.button.callback(m.text, m.data)))
            }
        }

        return arr
    }

    // NOTE: check text length for each btn and select correct perline for each row(after determine max line len)
    private createCommandBuilderKeyboard(markup: IBaseMarkup, perLine = 3) {
        let arr: Array<Array<InlineKeyboardButton.CallbackButton>> = []
        const mk_options = markup.buttons
        if (!mk_options) {
            return [[]]
        }
        for (let i = 0; i < mk_options.length; i += perLine) {
            arr.push(
                mk_options.slice(i, i + perLine).filter(m => m.type != 'aux').map(m =>
                    telegraf.Markup.button.callback(
                        m.text,
                        "builder_"+m.data
                    )
                )
            )
        }

        const defaultMkArray: Array<InlineKeyboardButton.CallbackButton> = []
        mk_options.filter(m => m.type == 'aux').forEach(m => {
            defaultMkArray.push(
                telegraf.Markup.button.callback(`${UiUnicodeSymbols.gear} ${m.text}`, "builder_"+m.data)
            )
        })
        return arr.concat([defaultMkArray])
    }

    private async replyByCommandResult(ctx: TgContext, response: IHandleResult) {
        log.trace(`replyByCommandResult buttons: ${JSON.stringify(response.markup?.buttons?.map(b => ({text: b.text, type: b.type, data: b.data})))}`)
        const layout = response.markup ? this.createCommandBuilderKeyboard(response.markup) : []
        log.trace(`replyByCommandResult layout rows: ${layout.length}, buttons per row: ${layout.map(r => r.length)}`)
        const hasButtons = layout.some(row => row.length > 0)
        let keyboard = telegraf.Markup.inlineKeyboard(layout)
        const sendText = response.markup?.text
        const userId = TelegramUI.UserIdFromCtx(ctx)

        const msgType = response.messageType ?? (hasButtons ? 'builder' : 'result')

        // Delete previous builder messages before sending new builder message
        if (msgType === 'builder') {
            await this.lifecycle.cleanupByType(userId, 'builder')
        }

        if (sendText && sendText.length) {
            const sent = await ctx.reply(sendText, hasButtons ? keyboard : undefined)
            this.lifecycle.track(userId, String(sent.message_id), msgType)
        } else {
            log.debug(`Command "NOT IMPLEMENTED" "${userId}" has no text to send`)
        }
    }

    private async handleInput(input: string, userText: string, ctx: TgContext) {
        // Plugin command interceptors
        for (const p of this.plugins) {
            if (p.onBeforeCommand) {
                const allowed = await p.onBeforeCommand(input, userText, ctx)
                if (!allowed) return
            }
        }

        try {
            let response = await this.dispatcher.handleCommand(input, userText, ctx, this)

            // Plugin post-command interceptors
            for (const p of this.plugins) {
                if (p.onAfterCommand) {
                    response = await p.onAfterCommand(input, response, ctx)
                }
            }

            await this.replyByCommandResult(ctx, response)
        } catch (e: any) {
            const sent = await ctx.reply(`TelegramUI::handleCmd error: ${anyToString(e)}`)
            this.lifecycle.track(TelegramUI.UserIdFromCtx(ctx), String(sent.message_id), 'system')
            log.error(`Command "${input}" "${TelegramUI.UserIdFromCtx(ctx)}" error: ${anyToString(e)}`, e)
        }
    }

    // VV Specials VV

    ContextType(): string {
        return 'telegram'
    }

    public lock(lockManager: LockManager): boolean {
        return typeof lockManager.createLockFile(
            crypto.hash("sha256", getInitialConfig().bot.token)
        ) === 'string'
    }

    public unlock(lockManager: LockManager): boolean {
        return lockManager.deleteLockFile(
            LockManager.createLockFileName(
                crypto.hash("sha256", getInitialConfig().bot.token)
            )
        )
    }

    isRunning(): boolean {
        return this.isActive
    }

    consolePrintCommands(): void {
        let cmdString = ''
        for (const cmd of this.dispatcher.toUICommands()) {
            cmdString += ` -- ${cmd.command} - ${cmd.description}\n`
        }
        log.info(cmdString)
    }

}
