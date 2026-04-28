import { CLIContext } from './types';
import { ICLIPlugin } from './types/plugin';
import {
    CmdDispatcher,
    CLI_USER_ID,
    CLI_USER_NAME,
    BaseUI,
    CmdHubApp,
} from '@cmd-hub/core';
import {
    LockManager,
    type ManagerRecord,
    type AppLike,
    log,
    registerBuiltinRenderers,
    BUILTIN_COMPAT_PREFIX,
    BUILTIN_VERSION,
    severityIconPrefix,
    nodeAtPath,
    type OptionsTree,
    type UiSeverity,
    type UiUiMessageKindPlugin,
} from '@cmd-hub/common';

import readline from 'readline';

const ANSI_RESET = '\x1b[0m'
const ANSI_BY_SEVERITY: Record<UiSeverity, string> = {
    error: '\x1b[31m',
    warn: '\x1b[33m',
    success: '\x1b[32m',
    info: '\x1b[36m',
}

const CliTextKind: UiUiMessageKindPlugin<{ text: string }, string> = {
    kind: 'text',
    compatibilityId: `${BUILTIN_COMPAT_PREFIX}.text`,
    version: BUILTIN_VERSION,
    render: (payload, ctx) => {
        if (!ctx.severity) return payload.text
        const body = `${severityIconPrefix(ctx.severity)}${payload.text}`
        return `${ANSI_BY_SEVERITY[ctx.severity]}${body}${ANSI_RESET}`
    },
}

const PLACEHOLDER_MANAGER: ManagerRecord = {
    id: '',
    userId: CLI_USER_ID,
    name: CLI_USER_NAME,
    isAdmin: true,
    online: false,
    accountId: null,
    useGreeting: true,
    messageWidth: null,
    passwordHash: null,
}

export class CLIUI extends BaseUI<CLIContext> {
    private context: CLIContext;
    private rl?: readline.Interface
    private isActive: boolean = false
    private cmds: string[]

    constructor(
        public readonly dispatcher: CmdDispatcher<CLIContext>
    ) {
        super()
        this.context = {
            type: 'cli',
            manager: { ...PLACEHOLDER_MANAGER },
            userSession: { state: '', data: {} },
            text: "",
            reply: async (message: string) => {
                console.log('[' + new Date().toLocaleTimeString("ru") + ']' + "[CLI] < " + message);
            }
        };
        this.cmds = this.dispatcher.toUICommands().map(cmd => cmd.command)
        console.log(this.cmds)
        this.setInitialized()
    }

    async onAppAttach(app: AppLike): Promise<void> {
        this.attachReposFromApp(app)
        if (app instanceof CmdHubApp) {
            const registry = app.uiMessageRegistryFor(this)
            registerBuiltinRenderers(registry, ['markdown', 'list', 'kv', 'link'])
            // Override the auto-registered plain `text` with an ANSI-coloured
            // variant: the CLI is a TTY, so severity translates directly to
            // SGR codes. Tests / non-tty stdout still see the codes; consumers
            // that care strip them via standard ANSI utilities.
            registry.register(CliTextKind)
        }
    }

    // Platform-specific implementations for BaseUI

    protected async sendMessageImpl(_user_id: string, message: string, _markup?: unknown[], _options?: unknown): Promise<string> {
        console.log('[' + new Date().toLocaleTimeString("ru") + ']' + "[CLI] < " + message)
        return String(Date.now())
    }

    protected async editMessageImpl(_user_id: string, _message_id: string, message?: string, _markup?: unknown[], _options?: unknown): Promise<void> {
        if (message) {
            console.log('[' + new Date().toLocaleTimeString("ru") + ']' + "[CLI] (edit) < " + message)
        }
    }

    protected async deleteMessageImpl(_user_id: string, _message_id: string): Promise<void> {
        // no-op for CLI
    }

    max_message_width(): number {
        return 80
    }

    consolePrintCommands(): void {
        console.log(this.cmds)
    }

    lock(_: LockManager): boolean {
        return true
    }

    unlock(_: LockManager): boolean {
        return true
    }

    ContextType(): string {
        return 'cli'
    }

    isRunning(): boolean {
        return this.isActive
    }

    async run() {
        if (!this.isInitialized()) {
            throw new Error("CLIUI::run() not initialized")
        }

        if (this.isActive) {
            throw new Error("CLIUI::run() already running")
        }

        const repos = this.requireRepos('run')
        const manager = await repos.manager.createWithAccount({
            isAdmin: true,
            name: CLI_USER_NAME,
            userId: CLI_USER_ID,
            useGreeting: true,
        })
        this.context.manager = manager

        // Collect completions from plugins
        let completions = [...this.cmds]
        for (const p of this.plugins) {
            const cp = p as ICLIPlugin
            if (cp.extendCompletions) {
                completions = cp.extendCompletions(completions)
            }
        }

        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            historySize: 100,
            prompt: '[CLI] >',
            completer: (line: string): [string[], string] => this._complete(line, completions),
        })

        log.info("Starting CLI...")

        // Plugin init
        await this.initPlugins()

        this.rl.on('line', async (line) => {
            // Plugin raw input interceptor
            let processedLine: string | false = line
            for (const p of this.plugins) {
                const cp = p as ICLIPlugin
                if (cp.onRawInput) {
                    processedLine = await cp.onRawInput(processedLine as string)
                    if (processedLine === false) return
                }
            }
            line = processedLine as string

            this.context.text = line;
            const [command, ...args] = line.split(' ');
            this.context.userSession.data.args = args;

            // Plugin before-command interceptors
            for (const p of this.plugins) {
                if (p.onBeforeCommand) {
                    const allowed = await p.onBeforeCommand(command, line, this.context)
                    if (!allowed) return
                }
            }

            let response = await this.dispatcher!.handleCommand(command, line, this.context, this);

            // Plugin after-command interceptors
            for (const p of this.plugins) {
                if (p.onAfterCommand) {
                    response = await p.onAfterCommand(command, response, this.context)
                }
            }

            if (response.markup?.text) {
                this.context.reply(String(response.markup.text));
            }
        });

        this.isActive = true
    }

    /** Tree-aware completer. Three cases, in order:
     *
     *   1. Empty / single token: complete command names (plus any
     *      plugin-supplied extras).
     *   2. After `/cmd ... --branch --leaf` partials: walk the command's
     *      `OptionsTree` along the `--name` tokens already on the line
     *      and suggest the current branch's children (or a pending leaf's
     *      `options[]`) prefixed with `--` / `-` to match the parser
     *      grammar.
     *   3. Anything else: fall back to global startsWith filter (covers
     *      plugin-extended completions like file paths).
     */
    private _complete(line: string, completions: string[]): [string[], string] {
        const parts = line.split(/\s+/)
        if (parts.length <= 1) {
            const matches = completions.filter(c => c.startsWith(line))
            return [matches, line]
        }
        const command = parts[0]
        const tail = parts[parts.length - 1]
        const tree = this._treeForCommand(command)
        if (!tree) {
            return [completions.filter(c => c.startsWith(line)), line]
        }
        // Walk the tree by every `--`/`-` token already on the line.
        // The walk lands either on a branch (suggest its children) or
        // on a leaf (suggest its `options[]` as values).
        const path: string[] = []
        for (let i = 1; i < parts.length - 1; i++) {
            const seg = parts[i].replace(/^--?/, '')
            if (!seg) continue
            const here = nodeAtPath(tree, path)
            if (!here || here.node !== 'branch') break
            const child = here.children.get(seg)
            if (!child) continue
            // Pair leaves consume the next token as a value, so skip it.
            if (child.node === 'leaf' && !child.standalone && child.position === 0) {
                i++
                continue
            }
            if (child.node === 'branch') path.push(seg)
        }
        const here = nodeAtPath(tree, path)
        if (!here) return [[], tail]
        if (here.node === 'leaf') {
            // Suggest options for the pending leaf's value.
            const matches = here.options.filter(o => o.startsWith(tail))
            return [matches, tail]
        }
        const suggestions: string[] = []
        for (const [name, child] of here.children) {
            const prefix = child.node === 'leaf' && child.standalone ? '-' : '--'
            suggestions.push(`${prefix}${name}`)
        }
        const matches = suggestions.filter(s => s.startsWith(tail))
        return [matches, tail]
    }

    private _treeForCommand(command: string): OptionsTree | undefined {
        const stripped = command.startsWith('/') ? command.slice(1) : command
        return this.dispatcher.getCommandTree(stripped)
    }

    async terminate() {
        if (!this.isActive) {
            throw new Error("CLIUI::terminate() not running")
        }
        if (this.rl) {
            this.rl.close()
        }
        await this.terminatePlugins()
        await this.dispatcher.stopAllServices()
        this.isActive = false
        log.info(" -- CLI ui stopped");
    }
}
