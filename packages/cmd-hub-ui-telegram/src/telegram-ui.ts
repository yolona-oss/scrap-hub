import { BaseUI } from '@cmd-hub/core'
import { MessageType } from '@cmd-hub/core'

import { TelegramUI_BuiltIns, toRegister } from './constants/commands'
import { TgContext } from "./types"
import { ITelegramPlugin } from './types/plugin'

import { LockManager } from '@cmd-hub/core'
import type { UIFederationRequires } from '@cmd-hub/core'
import {
    log,
    readConfigSlice,
    requireCap,
    CAP_ManagerRepo,
    CAP_AccountRepo,
    CAP_InvitationLinkRepo,
    CAP_CmdAliasRepo,
    CAP_PendingDeleteRepo,
    CAP_StorageConnection,
    CAP_ServiceStore,
    CAP_HttpAgent,
    type ManagerRecord,
    type MessageHistoryInput,
    type AppLike,
} from '@cmd-hub/common'
import type { DispatcherRepos } from '@cmd-hub/core'

import crypto from 'crypto'
import type { Agent } from 'http'
import * as telegraf from 'telegraf'
import chalk from 'chalk'
import { anyToString } from '@cmd-hub/core'
import { IUICommandProcessed } from '@cmd-hub/core'
import { InlineKeyboardButton } from 'telegraf/typings/core/types/typegram'
import { UiUnicodeSymbols, handleCalibrationCallback } from '@cmd-hub/core'
import type { MessageOptions } from '@cmd-hub/core'
import { z } from 'zod'

function fromTgContext(ctx: TgContext): MessageHistoryInput {
    return {
        chatId: ctx.chat!.id,
        userId: ctx.from!.id,
        text: ctx.text ?? "",
        messageId: ctx.message!.message_id,
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
    private repos: DispatcherRepos | null = null

    public requireRepos(callerName: string): DispatcherRepos {
        if (!this.repos) {
            throw new Error(`TelegramUI.${callerName}: not attached to app — onAppAttach didn't run`)
        }
        return this.repos
    }

    readonly federationRequires: UIFederationRequires = {
        essential: [CAP_StorageConnection, CAP_ServiceStore],
        supported: [],
    }

    readonly namespace = 'telegram' as const
    readonly schema = z.object({
        botToken: z.string().min(1),
        botName: z.string().min(1).default('CmdHub'),
        primaryAdminId: z.union([z.string(), z.number()]),
        adminUserIds: z.array(z.union([z.string(), z.number()])).default([]),
    })

    private tgConfig: z.infer<TelegramUI['schema']> | null = null

    public requireTgConfig(callerName: string): z.infer<TelegramUI['schema']> {
        if (!this.tgConfig) {
            throw new Error(`TelegramUI.${callerName}: not attached to app — onAppAttach didn't run`)
        }
        return this.tgConfig
    }

    /** Parameterless form is preferred; the back-compat constructor lets you
     *  bootstrap without CmdHubApp by passing token + dispatcher. */
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

    async onAppAttach(app: AppLike): Promise<void> {
        const cfg = readConfigSlice(app, this)
        this.tgConfig = cfg
        if (!this.bot) {
            // If a ProxyMiddleware published an HTTP agent, route api.telegram.org through it.
            const agent = app.get(CAP_HttpAgent) as Agent | undefined
            const tgOpts: Partial<telegraf.Telegraf.Options<TgContext>> | undefined =
                agent ? { telegram: { agent } } : undefined
            this.bot = new telegraf.Telegraf<TgContext>(cfg.botToken, tgOpts)
        }
        if (!this.dispatcher) {
            this.dispatcher = new CmdDispatcher<TgContext>()
        }
        this.repos = {
            manager:        requireCap(app, CAP_ManagerRepo),
            account:        requireCap(app, CAP_AccountRepo),
            invitationLink: requireCap(app, CAP_InvitationLinkRepo),
            cmdAlias:       requireCap(app, CAP_CmdAliasRepo),
            pendingDelete:  requireCap(app, CAP_PendingDeleteRepo),
        }
        this.lifecycle.attachRepo(this.repos.pendingDelete)
        // Must finish before CmdHubApp's per-UI capability validator runs.
        if (!this.dispatcher.isInitialized()) {
            this.dispatcher.done()
        }
    }

    max_message_width() {
        return 72
    }

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
        this.bot.action(RegExp(auth_cb_prefix.directJoinRequestToAdmin + "*"), (ctx, next) => sendJoinRequestToAdmin.call(this, ctx, next))
        this.bot.action(RegExp(auth_cb_prefix.approveJoinRequest + "*"),       (ctx, next) => approveJoinRequest.call(this, ctx, next))
        this.bot.action(RegExp(auth_cb_prefix.rejectJoinRequest + "*"),        (ctx, next) => rejectJoinRequest.call(this, ctx, next))

        this.bot.action(RegExp('dashboard_*'), async (ctx) => {
            const action = String(ctx.match.input.slice('msg_bonder_'.length))

            const res = await this.dispatcher.handleCommand(action, action, ctx as any, this)
            await this.replyByCommandResult(ctx as any, res)
            await ctx.deleteMessage()
        })

        this.bot.action(RegExp("calibrate_*"), async (ctx) => {
            const width = parseInt(ctx.match.input.slice("calibrate_".length))
            if (!isNaN(width)) {
                const result = await handleCalibrationCallback(this.requireRepos('calibrate').manager, ctx.from!.id, width)
                await ctx.answerCbQuery(result)
                await ctx.deleteMessage()
            }
        })

        this.bot.action(RegExp("svc_dash_*"), async (ctx) => {
            const action = ctx.match.input.slice("svc_dash_".length)
            const userId = String(ctx.from!.id)
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

            // Track user input messages for cleanup. Commands aren't tracked
            // because they produce a result the user keeps.
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

        const tgCommands = this.registerTgComands()
        const commands = this.dispatcher.toUICommands().concat(tgCommands.map(cmd => cmd.command) as IUICommandProcessed[])

        this.verifyCommands(commands)
        log.info(`Commands verified ${chalk.green("successfully")}. Total commands: ${chalk.bold(commands.length)}`)

        this.setCommandHandler(commands)
        this.setByTextCmdHandler()

        for (const p of this.plugins) {
            const tp = p as ITelegramPlugin
            if (tp.setupCommands) {
                tp.setupCommands(this.bot)
            }
        }

        await this.bot.telegram.setMyCommands(commands)

        this.setInitialized()
    }

    /** Re-pushes the merged command list when a node attaches/detaches. */
    async onFederationChange(): Promise<void> {
        if (!this.bot || !this.dispatcher.isInitialized()) return
        const tgCommands = TelegramUI_BuiltIns.map(toRegister)
        const commands = this.dispatcher.toUICommands()
            .concat(tgCommands.map(cmd => cmd.command) as IUICommandProcessed[])
        try {
            this.verifyCommands(commands)
        } catch (e) {
            log.warn(`onFederationChange: refusing to push invalid command list: ${(e as Error)?.message ?? e}`)
            return
        }
        try {
            await this.bot.telegram.setMyCommands(commands)
            log.info(`onFederationChange: refreshed Telegram command list (${commands.length} commands)`)
        } catch (e) {
            log.warn(`onFederationChange: setMyCommands failed: ${(e as Error)?.message ?? e}`)
        }
    }

    private async setupAuth() {
        this.bot.use(async (ctx, next) => {
            const manager = await this.requireRepos('auth').manager.findByUserId(ctx.from!.id)
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
            const botName = this.requireTgConfig('setupAuth').botName
            const sent = await ctx.replyWithMarkdownV2(`Welcome to ${botName}. To start using bot you need to be aproved by bot administrator.\n" +
"Click on button for send approve request`,
                telegraf.Markup.inlineKeyboard([ [ { text: "Send", callback_data: auth_cb_prefix.directJoinRequestToAdmin + " " + ctx.from!.id  }, ] ]))
            this.lifecycle.track(String(ctx.from!.id), String(sent.message_id), 'system')
        })
    }

    private async setupHistorySave() {
        const self = this
        this.bot.on('message', async function(ctx, next) {
            const repos = self.requireRepos('historySave')
            if (ctx.manager) {
                const handle = await repos.manager.handleById(ctx.manager.id)
                if (handle) {
                    await handle.appendMessage(fromTgContext(ctx as TgContext))
                }
            } else if (ctx.message.from.is_bot) {
                // chat.id used as numeric userId — bot-as-manager convention.
                const handle = await repos.manager.handleByUserId(ctx.chat.id)
                if (handle) {
                    await handle.appendMessage({
                        chatId: ctx.chat!.id,
                        userId: handle.record.userId,
                        messageId: ctx.message?.message_id,
                        text: ctx.text ?? "",
                        timestamp: ctx.message?.date ? ctx.message.date : undefined,
                    })
                }
            } else {
                log.debug(`No manager in ctx for saving message history. user: ${ctx.from?.id}, chat: ${ctx.chat?.id}, message: ${ctx.message?.message_id}`)
            }
            return await next()
        })

        this.bot.on('edited_message', async function(ctx, next) {
            const handle = await self.requireRepos('historyEdit').manager.handleById(ctx.manager.id)
            if (handle) {
                await handle.appendMessage(fromTgContext(ctx as TgContext))
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

        const tgCfg = this.requireTgConfig('run')

        if (this.isActive) {
            throw new Error("TelegemUI::run() already running")
        }

        const repos = this.requireRepos('run')
        try {
            const primaryAdminId = Number(tgCfg.primaryAdminId)
            if (Number.isNaN(primaryAdminId)) {
                throw new Error(`config.telegram.primaryAdminId must coerce to a number, got "${tgCfg.primaryAdminId}"`)
            }
            let adminExisted = true
            const admin = await repos.manager.findByUserId(primaryAdminId)
            if (!admin) {
                log.info("Creating admin...")
                adminExisted = false
                await repos.manager.createWithAccount({
                    isAdmin: true,
                    name: "Admin",
                    userId: primaryAdminId,
                    useGreeting: true,
                })
            }
            log.info("Starting Telegram-bot service...")
            this.bot.launch(() => {
                log.info("Telegram-bot service launched!")
            })
            if (adminExisted) {
                log.info("Sending welcome message to admins...")
                for (const manager of await repos.manager.list()) {
                    if (!manager.useGreeting) {
                        continue
                    }
                    try {
                        await this.notifyManagers(manager.userId, `${UiUnicodeSymbols.info} Service now online`)
                    } catch (e: unknown) {
                        const message = (e as Error)?.message ?? String(e)
                        log.warn(`Failed to send startup greeting to manager ${manager.userId}: ${message}`)
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
        const repos = this.requireRepos('terminate')
        await repos.manager.setAllOffline()
        const managers = await repos.manager.list()
        for (const manager of managers) {
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
            crypto.hash("sha256", this.requireTgConfig('lock').botToken)
        ) === 'string'
    }

    public unlock(lockManager: LockManager): boolean {
        return lockManager.deleteLockFile(
            LockManager.createLockFileName(
                crypto.hash("sha256", this.requireTgConfig('unlock').botToken)
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
