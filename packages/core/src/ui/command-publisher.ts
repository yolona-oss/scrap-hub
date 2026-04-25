import type { BaseUIContext } from '@cmd-hub/common'
import type { CmdDispatcher } from './command-processor'
import type { IUICommandProcessed } from './types/command'

/** Constraints a target platform imposes on its published command list. */
export interface CommandPublishConstraints {
    /** Maximum command name length (in chars). */
    maxCmdLen: number
    /** Maximum description length (in chars). */
    maxDescLen: number
    /** Regex of characters allowed in command names. Tested against the whole name. */
    nameAllowedSymbols: RegExp
}

/** Telegram's `setMyCommands` constraints (BotFather rules). */
export const TELEGRAM_COMMAND_CONSTRAINTS: CommandPublishConstraints = {
    maxCmdLen: 32,
    maxDescLen: 256,
    nameAllowedSymbols: /^[A-Za-z0-9_]+$/,
}

/**
 * Build and validate the merged command list a UI publishes externally
 * (Telegram's setMyCommands, Web's command palette, etc.).
 *
 * The list is dispatcher-known commands plus any UI-specific extras (e.g.
 * Telegram's `/start`). `verify` enforces optional platform constraints —
 * UIs that don't have constraints (CLI, Web) skip verification.
 */
export class CommandPublisher<Ctx extends BaseUIContext> {
    constructor(
        private readonly dispatcher: CmdDispatcher<Ctx>,
        private readonly extras: () => IUICommandProcessed[] = () => [],
        private readonly constraints?: CommandPublishConstraints,
    ) {}

    /** Merged dispatcher commands + UI extras. */
    list(): IUICommandProcessed[] {
        return this.dispatcher.toUICommands().concat(this.extras())
    }

    /** Throws on the first violation. No-op when no constraints were set. */
    verify(cmds: ReadonlyArray<IUICommandProcessed>): void {
        const c = this.constraints
        if (!c) return
        for (const cmd of cmds) {
            if (cmd.command.length > c.maxCmdLen) {
                throw new Error(`Command "${cmd.command}" is too long (max ${c.maxCmdLen}, got ${cmd.command.length})`)
            }
            if (!c.nameAllowedSymbols.test(cmd.command)) {
                throw new Error(`Command "${cmd.command}" contains invalid symbols`)
            }
            if (cmd.description.length > c.maxDescLen) {
                throw new Error(`Description of "${cmd.command}" is too long (max ${c.maxDescLen}, got ${cmd.description.length})`)
            }
        }
    }

    /** Convenience: list + verify in one call. */
    listAndVerify(): IUICommandProcessed[] {
        const cmds = this.list()
        this.verify(cmds)
        return cmds
    }
}
