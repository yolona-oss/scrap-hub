import express from 'express'
import http from 'http'
import path from 'path'
import { Server as SocketIOServer, Socket } from 'socket.io'

import { WebContext } from './types/context'
import { IWebUIPlugin } from './types/plugin'
import { BaseUI } from '@cmd-hub/core'
import { CmdDispatcher } from '@cmd-hub/core'
import { IMarkupOption } from '@cmd-hub/core'
import { exposeCmdArgumentOptions } from '@cmd-hub/core'
import { CBDescriptorCompiler } from '@cmd-hub/core'
import { CmdHubApp } from '@cmd-hub/core'
import {
    LockManager,
    log,
    registerBuiltinRenderers,
    BUILTIN_COMPAT_PREFIX,
    BUILTIN_VERSION,
    type MessageOptions,
    type ManagerRecord,
    type AppLike,
    type UiUiMessageKindPlugin,
} from '@cmd-hub/common'
import crypto from 'crypto'

/** Web text renderer: emit JSON so the browser can apply CSS classes by
 *  severity. Plain text without severity stays plain text — no JSON
 *  envelope — so test harnesses and curl users keep readable output. */
const WebTextKind: UiUiMessageKindPlugin<{ text: string }, string> = {
    kind: 'text',
    compatibilityId: `${BUILTIN_COMPAT_PREFIX}.text`,
    version: BUILTIN_VERSION,
    render: (payload, ctx) => {
        if (!ctx.severity) return payload.text
        return JSON.stringify({ kind: 'text', severity: ctx.severity, text: payload.text })
    },
}

// --- Password hashing ---

function hashPassword(password: string): string {
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.scryptSync(password, salt, 64).toString('hex')
    return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string): boolean {
    const [salt, hash] = stored.split(':')
    if (!salt || !hash) return false
    const derived = crypto.scryptSync(password, salt, 64).toString('hex')
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'))
}

// --- Session tokens with TTL and scope ---

interface SessionEntry {
    userId: string
    createdAt: number
    scope: 'full' | 'set-password'  // limited scope for first-login
}

const SESSION_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours
const sessions = new Map<string, SessionEntry>()

function createSession(userId: number | string, scope: 'full' | 'set-password' = 'full'): string {
    const token = crypto.randomUUID()
    sessions.set(token, { userId: String(userId), createdAt: Date.now(), scope })
    return token
}

function getSession(token: string): SessionEntry | undefined {
    const entry = sessions.get(token)
    if (!entry) return undefined
    if (Date.now() - entry.createdAt > SESSION_TTL_MS) {
        sessions.delete(token)
        return undefined
    }
    return entry
}

function getSessionUserId(token: string, requiredScope: 'full' | 'set-password' = 'full'): string | undefined {
    const entry = getSession(token)
    if (!entry) return undefined
    if (requiredScope === 'full' && entry.scope !== 'full') return undefined
    return entry.userId
}

function revokeSession(token: string): void {
    sessions.delete(token)
}

function upgradeSessionScope(token: string): void {
    const entry = sessions.get(token)
    if (entry) entry.scope = 'full'
}

// Cleanup expired sessions every 10 minutes
setInterval(() => {
    const now = Date.now()
    for (const [token, entry] of sessions) {
        if (now - entry.createdAt > SESSION_TTL_MS) sessions.delete(token)
    }
}, 10 * 60 * 1000)

// --- WebUI ---

interface AuthenticatedSocket extends Socket {
    manager?: ManagerRecord
}

export class WebUI extends BaseUI<WebContext> {
    private app: express.Express
    private server: http.Server
    private io: SocketIOServer
    private port: number
    private isActive = false
    private sockets = new Map<string, AuthenticatedSocket>()
    private userSockets = new Map<string, Set<string>>()

    constructor(
        port: number,
        public readonly dispatcher: CmdDispatcher<WebContext>,
    ) {
        super()
        this.port = port
        this.app = express()
        this.server = http.createServer(this.app)
        this.io = new SocketIOServer(this.server)

        this.setInitialized()
    }

    async onAppAttach(app: AppLike): Promise<void> {
        this.attachReposFromApp(app)
        // Plan A: text-mode renderers identical to CLI. The Plan B
        // browser-side React runtime will register a richer renderer
        // that emits `{component, props}` JSON and let the browser dispatch
        // through its own component registry.
        if (app instanceof CmdHubApp) {
            const registry = app.uiMessageRegistryFor(this)
            registerBuiltinRenderers(registry, ['markdown', 'list', 'kv', 'link'])
            registry.register(WebTextKind)
        }
    }

    // --- BaseUI abstract implementations ---

    protected async sendMessageImpl(user_id: string, message: string, mk_opts?: IMarkupOption[], options?: MessageOptions): Promise<string> {
        const msgId = crypto.randomUUID()
        const payload: Record<string, unknown> = { id: msgId, text: message, markup: mk_opts }
        if (options?.parseMode) payload.parseMode = options.parseMode
        this.emitToUser(user_id, 'message', payload)
        return msgId
    }

    protected async editMessageImpl(user_id: string, message_id: string, message?: string, mk_opts?: IMarkupOption[], options?: MessageOptions): Promise<void> {
        const payload: Record<string, unknown> = { id: message_id, text: message, markup: mk_opts }
        if (options?.parseMode) payload.parseMode = options.parseMode
        this.emitToUser(user_id, 'message:edit', payload)
    }

    protected async deleteMessageImpl(user_id: string, message_id: string): Promise<void> {
        this.emitToUser(user_id, 'message:delete', { id: message_id })
    }

    max_message_width(): number { return 80 }

    consolePrintCommands(): void {
        log.info('WebUI commands:', this.dispatcher.toUICommands().map(c => c.command))
    }

    lock(_: LockManager): boolean { return true }
    unlock(_: LockManager): boolean { return true }
    ContextType(): string { return 'web' }
    isRunning(): boolean { return this.isActive }

    // --- Lifecycle ---

    async run(): Promise<void> {
        if (this.isActive) throw new Error('WebUI already running')

        await this.ensureDefaultAdmin()

        this.setupRoutes()
        this.setupSocketAuth()
        this.setupSocketHandlers()

        await this.initPlugins()

        for (const p of this.plugins) {
            const wp = p as IWebUIPlugin
            if (wp.setupRoutes) wp.setupRoutes(this.app)
        }

        await new Promise<void>((resolve) => {
            this.server.listen(this.port, () => {
                log.info(`WebUI listening on port ${this.port}`)
                resolve()
            })
        })

        this.isActive = true
    }

    async terminate(): Promise<void> {
        if (!this.isActive) return
        this.io.close()
        this.server.close()
        await this.terminatePlugins()
        await this.dispatcher.stopAllServices()
        this.isActive = false
        log.info('WebUI stopped')
    }

    // --- Routes ---

    private setupRoutes(): void {
        this.app.use(express.json())

        const publicDir = path.join(__dirname, 'public')
        this.app.use(express.static(publicDir))

        // --- Auth: login with name + password ---
        this.app.post('/api/auth/login', async (req, res) => {
            try {
                const repos = this.requireRepos('login')
                const { name, password } = req.body
                if (!name) {
                    res.status(400).json({ error: 'Name required' })
                    return
                }

                const manager = await repos.manager.findByName(name)
                if (!manager) {
                    res.status(401).json({ error: 'Invalid credentials' })
                    return
                }

                // Admin without password: first login — issue limited-scope session for password setup only
                if (!manager.passwordHash) {
                    const sessionToken = createSession(manager.userId, 'set-password')
                    res.json({
                        sessionToken,
                        userId: manager.userId,
                        name: manager.name,
                        isAdmin: manager.isAdmin,
                        requirePasswordChange: true,
                    })
                    return
                }

                if (!password || !verifyPassword(password, manager.passwordHash)) {
                    res.status(401).json({ error: 'Invalid credentials' })
                    return
                }

                const sessionToken = createSession(manager.userId)
                res.json({
                    sessionToken,
                    userId: manager.userId,
                    name: manager.name,
                    isAdmin: manager.isAdmin,
                })
            } catch (e: unknown) {
                log.error(`WebUI API error: ${(e as Error)?.message ?? e}`)
                res.status(500).json({ error: 'Internal server error' })
            }
        })

        // --- Auth: set password (first login or change) ---
        this.app.post('/api/auth/set-password', async (req, res) => {
            try {
                const repos = this.requireRepos('setPassword')
                const { sessionToken, password } = req.body
                if (!password || password.length < 8) {
                    res.status(400).json({ error: 'Password must be at least 8 characters' })
                    return
                }

                const session = getSession(sessionToken)
                if (!session) {
                    res.status(401).json({ error: 'Invalid session' })
                    return
                }
                const manager = await repos.manager.findByUserId(Number(session.userId))
                if (!manager) {
                    res.status(401).json({ error: 'Invalid session' })
                    return
                }

                await repos.manager.updateById(manager.id, { passwordHash: hashPassword(password) })
                upgradeSessionScope(sessionToken)

                res.json({
                    ok: true,
                    sessionToken,
                    userId: manager.userId,
                    name: manager.name,
                    isAdmin: manager.isAdmin,
                })
            } catch (_) {
                res.status(500).json({ error: 'Failed to set password' })
            }
        })

        // --- Auth: logout ---
        this.app.post('/api/auth/logout', (req, res) => {
            const token = req.body.sessionToken
            if (token) revokeSession(token)
            res.json({ ok: true })
        })

        // --- Invitation link creation (admin only, authenticated) ---
        this.app.post('/api/invite', async (req, res) => {
            try {
                const repos = this.requireRepos('invite')
                const manager = await this.resolveSession(req.body.sessionToken)
                if (!manager?.isAdmin) {
                    res.status(403).json({ error: 'Admin access required' })
                    return
                }
                const token = crypto.randomUUID()
                await repos.invitationLink.create({ token, createdBy: manager.userId })
                const link = `${req.protocol}://${req.get('host')}/invite/${token}`
                res.json({ link, token })
            } catch (e: unknown) {
                log.error(`WebUI API error: ${(e as Error)?.message ?? e}`)
                res.status(500).json({ error: 'Internal server error' })
            }
        })

        // --- Invitation link acceptance: register with name + password ---
        this.app.post('/api/invite/:token/accept', async (req, res) => {
            try {
                const repos = this.requireRepos('inviteAccept')
                const { name, password } = req.body
                if (!name || !password) {
                    res.status(400).json({ error: 'Name and password required' })
                    return
                }
                if (password.length < 8) {
                    res.status(400).json({ error: 'Password must be at least 8 characters' })
                    return
                }

                const invite = await repos.invitationLink.findByToken(req.params.token, { onlyUnused: true })
                if (!invite) {
                    res.status(404).json({ error: 'Invalid or used invitation' })
                    return
                }
                if (invite.expiresAt && invite.expiresAt < new Date()) {
                    res.status(410).json({ error: 'Invitation expired' })
                    return
                }

                const existing = await repos.manager.findByName(name)
                if (existing) {
                    res.status(409).json({ error: 'Name already taken' })
                    return
                }

                const userId = crypto.randomInt(100000000, 999999999)
                await repos.manager.createWithAccount({
                    userId,
                    name,
                    isAdmin: false,
                    useGreeting: true,
                    passwordHash: hashPassword(password),
                })

                await repos.invitationLink.markUsed(invite.token, userId)

                const sessionToken = createSession(userId)
                res.json({ sessionToken, userId, name })
            } catch (e: unknown) {
                log.error(`WebUI API error: ${(e as Error)?.message ?? e}`)
                res.status(500).json({ error: 'Internal server error' })
            }
        })

        // --- Available commands (static metadata only, no auth required) ---
        this.app.get('/api/commands', (_req, res) => {
            res.json(this.dispatcher.toUICommands().map(c => ({
                command: c.command,
                description: c.description,
            })))
        })

        // SPA fallback
        this.app.get('{*path}', (_req, res) => {
            res.sendFile(path.join(publicDir, 'index.html'))
        })
    }

    // --- Socket.IO Auth (session token) ---

    private setupSocketAuth(): void {
        this.io.use(async (socket: AuthenticatedSocket, next) => {
            const sessionToken = socket.handshake.auth.sessionToken as string
            if (!sessionToken) {
                return next(new Error('Authentication required'))
            }

            const manager = await this.resolveSession(sessionToken)
            if (!manager) {
                return next(new Error('Invalid or expired session'))
            }

            socket.manager = manager
            next()
        })
    }

    // --- Socket.IO Handlers ---

    private setupSocketHandlers(): void {
        this.io.on('connection', async (rawSocket: Socket) => {
            const socket = rawSocket as AuthenticatedSocket
            const manager = socket.manager!
            const userId = String(manager.userId)

            this.sockets.set(socket.id, socket)
            if (!this.userSockets.has(userId)) {
                this.userSockets.set(userId, new Set())
            }
            this.userSockets.get(userId)!.add(socket.id)

            log.info(`WebUI: user "${manager.name}" connected (socket ${socket.id})`)

            socket.emit('connected', {
                userId: manager.userId,
                name: manager.name,
                isAdmin: manager.isAdmin,
                commands: await this.serializeCommandsForUser(manager),
            })

            socket.on('command', async (data: { text: string }) => {
                if (!data.text?.trim()) return

                const ctx = this.createContext(socket, data.text)
                const [command] = data.text.split(' ')

                try {
                    for (const p of this.plugins) {
                        if (p.onBeforeCommand) {
                            const allowed = await p.onBeforeCommand(command, data.text, ctx)
                            if (!allowed) return
                        }
                    }

                    let response = await this.dispatcher.handleCommand(command, data.text, ctx, this)

                    for (const p of this.plugins) {
                        if (p.onAfterCommand) {
                            response = await p.onAfterCommand(command, response, ctx)
                        }
                    }

                    if (response.markup?.text) {
                        socket.emit('message', {
                            id: crypto.randomUUID(),
                            text: response.markup.text,
                            type: 'command-result',
                        })
                    }
                } catch (e: unknown) {
                    socket.emit('message', {
                        id: crypto.randomUUID(),
                        text: `Error: ${(e as Error)?.message ?? e}`,
                        type: 'error',
                    })
                }
            })

            socket.on('callback', async (data: { action: string }) => {
                if (!data.action) return
                const services = this.dispatcher.UserActiveServices(userId)
                for (const svc of services) {
                    const dashboard = this.dispatcher.getDashboard(userId, svc.name)
                    if (dashboard) {
                        try { await dashboard.handleCallback(data.action) } catch (_) {}
                    }
                }
            })

            // Builder: resolve full descriptors + saved config for a command
            socket.on('builder:open', async (data: { command: string }) => {
                if (!data.command) return
                try {
                    const repos = this.requireRepos('builder:open')
                    const isService = this.dispatcher.isService(data.command)
                    const ctx = this.createContext(socket, data.command)
                    const compiler = new CBDescriptorCompiler<WebContext>()
                    const descriptor = await compiler.compile(data.command, userId, this.dispatcher, ctx)

                    interface ArgWithOptions {
                        name: string
                        ctx: string
                        position?: number
                        standalone?: boolean
                        required?: boolean
                        description?: string
                        defaultValue?: string
                        pairOptions?: string[]
                    }

                    // Serialize args for the client
                    const fields = descriptor.args.map((a: ArgWithOptions) => ({
                        name: a.name,
                        ctx: a.ctx,
                        type: a.position != null ? 'positional' as const : a.standalone ? 'standalone' as const : 'pair' as const,
                        position: a.position,
                        required: a.required,
                        description: a.description,
                        defaultValue: a.defaultValue,
                        options: a.pairOptions ?? null,
                    }))

                    // Load saved config from AccountModule
                    let savedConfig: Record<string, unknown> = {}
                    if (isService) {
                        try {
                            const owner = await repos.manager.findByUserId(manager.userId)
                            if (owner?.accountId) {
                                const account = await repos.account.handleById(owner.accountId)
                                if (account) {
                                    const { module } = await account.getModuleByNameOrCreate(data.command)
                                    savedConfig = (module.record.data.config ?? {}) as Record<string, unknown>
                                }
                            }
                        } catch (_) {}
                    }

                    socket.emit('builder:data', {
                        command: data.command,
                        isService,
                        fields,
                        savedConfig,
                    })
                } catch (e: unknown) {
                    socket.emit('builder:data', { command: data.command, error: (e as Error)?.message })
                }
            })

            socket.on('disconnect', () => {
                this.sockets.delete(socket.id)
                const userSet = this.userSockets.get(userId)
                if (userSet) {
                    userSet.delete(socket.id)
                    if (userSet.size === 0) this.userSockets.delete(userId)
                }
                log.info(`WebUI: user "${manager.name}" disconnected`)
            })
        })
    }

    // --- Helpers ---

    private createContext(socket: AuthenticatedSocket, text: string): WebContext {
        return {
            type: 'web',
            manager: socket.manager!,
            text,
            socketId: socket.id,
            reply: async (message: string, extra?: { parse_mode?: string }) => {
                socket.emit('message', {
                    id: crypto.randomUUID(),
                    text: message,
                    parseMode: extra?.parse_mode,
                    type: 'reply',
                })
            },
        }
    }

    private emitToUser(userId: string, event: string, data: unknown): void {
        const socketIds = this.userSockets.get(userId)
        if (!socketIds) return
        for (const sid of socketIds) {
            const socket = this.sockets.get(sid)
            if (socket) socket.emit(event, data)
        }
    }

    private async serializeCommandsForUser(manager: ManagerRecord) {
        const cmds = this.dispatcher.toUICommands()
        return Promise.all(cmds.map(async c => ({
            command: c.command,
            description: c.description,
            isService: this.dispatcher.isService(c.command),
            args: await Promise.all((c.args ?? []).map(async a => ({
                name: a.name,
                type: a.position != null ? 'positional' : a.standalone ? 'standalone' : 'pair',
                position: a.position,
                required: a.required,
                description: a.description,
                defaultValue: a.defaultValue,
                options: await exposeCmdArgumentOptions(c.command, a.pairOptions, this.dispatcher, manager) ?? null,
            }))),
        })))
    }

    private async resolveSession(sessionToken: string): Promise<ManagerRecord | null> {
        if (!sessionToken) return null
        const userId = getSessionUserId(sessionToken)
        if (!userId) return null
        return await this.requireRepos('resolveSession').manager.findByUserId(Number(userId))
    }

    // --- Default Admin ---

    private static readonly DEFAULT_ADMIN_NAME = 'admin'
    private static readonly DEFAULT_ADMIN_USER_ID = 1

    private async ensureDefaultAdmin(): Promise<void> {
        const repos = this.requireRepos('ensureDefaultAdmin')
        const existing = await repos.manager.findByUserId(WebUI.DEFAULT_ADMIN_USER_ID)
        if (existing) return

        await repos.manager.createWithAccount({
            userId: WebUI.DEFAULT_ADMIN_USER_ID,
            name: WebUI.DEFAULT_ADMIN_NAME,
            isAdmin: true,
            useGreeting: true,
            // passwordHash intentionally omitted — forces password setup on first login
        })
        log.info(`WebUI: default admin "${WebUI.DEFAULT_ADMIN_NAME}" created — set password on first login`)
    }

    // --- Public API ---

    async createInvitationLink(createdBy: number | string, expiresInMs?: number): Promise<string> {
        const token = crypto.randomUUID()
        const expiresAt = expiresInMs ? new Date(Date.now() + expiresInMs) : undefined
        await this.requireRepos('createInvitationLink').invitationLink.create({ token, createdBy, expiresAt })
        return token
    }
}
