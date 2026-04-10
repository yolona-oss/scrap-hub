import { CLIContext } from './types';
import { ICLIPlugin } from './types/plugin';
import { CmdDispatcher, CLI_USER_ID, CLI_USER_NAME } from '@core/ui/command-processor';

import { BaseUI } from '@core/ui/base-ui';
import { AvailableUIsEnum, AvailableUIsType } from '@core/ui/impls';
import { FilesWrapper, IManager, Manager } from '@core/db';

import { LockManager } from '@utils/lock-manager';
import log from '@logger';

import readline from 'readline';

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
            type: AvailableUIsEnum.CLI,
            manager: {} as IManager & { userId: number|string },
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

    // Platform-specific implementations for BaseUI

    protected async sendMessageImpl(_user_id: string, message: string, _markup?: any[], _options?: any): Promise<string> {
        console.log('[' + new Date().toLocaleTimeString("ru") + ']' + "[CLI] < " + message)
        return String(Date.now())
    }

    protected async editMessageImpl(_user_id: string, _message_id: string, message?: string, _markup?: any[], _options?: any): Promise<void> {
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

    ContextType(): AvailableUIsType {
        return AvailableUIsEnum.CLI
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

        let manager = await Manager.findOne({userId: CLI_USER_ID})
        if (!manager) {
            const avatar = await FilesWrapper.getDefaultAvatar()
            if (!avatar) {
                throw new Error("Default avatar not found")
            }

            manager = await Manager.create({
                isAdmin: true,
                name: CLI_USER_NAME,
                userId: CLI_USER_ID,
                online: false,
                avatar: avatar.id,
                useGreeting: true
            })
        }
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
            prompt: "[CLI] >",
            completer: (line: string) => {
                const matches = completions.filter((c) => c.startsWith(line));
                return matches
            }
        });

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
