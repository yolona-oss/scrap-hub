import {
    CmdArg,
    CAP_ManagerRepo,
    type IUIPlugin,
    type BaseUIContext,
    type IUI,
} from '@cmd-hub/common'
import 'reflect-metadata'
import type { CmdDispatcher } from '../ui/command-processor'
import type { CmdArgumentProxy } from '../ui/command-processor/arg-proxy'
import { UiUnicodeSymbols } from '../ui/ui-unicode-symbols'

/**
 * Manager-state admin commands packaged as a UI-agnostic plugin: `/setname`,
 * `/goonline`, `/gooffline`, `/status`, `/setgreeting`, `/wipe_chat`. Mounts on
 * any `BaseUI` subclass via `ui.use(new ManagerControlPlugin())`.
 *
 * Commands are registered through `onDispatcherSetup`, which fires before
 * `dispatcher.done()` locks the registry. The commands themselves call only
 * the abstract UI surface — no platform-specific imports — except `/wipe_chat`,
 * which delegates to `IUI.wipeUserMessages` (default impl on the core BaseUI;
 * Telegram overrides for chat-scoped delete).
 */

class SetNameArgs {
    @CmdArg({
        required: true,
        position: 1,
        description: 'Your new name (4–32 chars, latin/digits/space)',
        validator: (arg: string) =>
            Boolean(arg.trim().match(/^[a-zA-Z0-9 ]+$/)) && arg.length <= 32 && arg.length >= 4,
    })
    name?: string
}

class SetGreetingArgs {
    @CmdArg({
        required: true,
        position: 1,
        description: 'Toggle startup greeting',
        validator: (arg: string) => ['on', 'off'].includes(arg),
        choices: ['on', 'off'],
    })
    greeting?: string
}

export class ManagerControlPlugin<Ctx extends BaseUIContext = BaseUIContext>
    implements IUIPlugin<Ctx, unknown, CmdDispatcher<Ctx>>
{
    readonly name = 'manager-control'

    async onDispatcherSetup(dispatcher: CmdDispatcher<Ctx>, _ui: IUI<Ctx>): Promise<void> {
        dispatcher.registerMany([
            {
                command: { command: 'setname', description: 'Set your name', args: SetNameArgs },
                invokable: async function (this: CmdDispatcher<Ctx>, args: CmdArgumentProxy, ctx) {
                    const name = String(args.getOrThrow('name'))
                    const repos = this.requireRepos('setname')
                    await repos.manager.updateById(ctx.manager!.id, { name })
                    await ctx.reply(`Now you'll be called "${name}"`)
                },
                requires: [CAP_ManagerRepo],
            },
            {
                command: { command: 'goonline', description: 'Mark yourself as online' },
                invokable: async function (this: CmdDispatcher<Ctx>, _args: CmdArgumentProxy, ctx) {
                    const repos = this.requireRepos('goonline')
                    await repos.manager.updateById(ctx.manager!.id, { online: true })
                    await ctx.reply('You are now online.')
                },
                requires: [CAP_ManagerRepo],
            },
            {
                command: { command: 'gooffline', description: 'Mark yourself as offline' },
                invokable: async function (this: CmdDispatcher<Ctx>, _args: CmdArgumentProxy, ctx) {
                    const repos = this.requireRepos('gooffline')
                    await repos.manager.updateById(ctx.manager!.id, { online: false })
                    await ctx.reply('You are now offline.')
                },
                requires: [CAP_ManagerRepo],
            },
            {
                command: { command: 'status', description: 'Show your online status' },
                invokable: async function (this: CmdDispatcher<Ctx>, _args: CmdArgumentProxy, ctx) {
                    const repos = this.requireRepos('status')
                    const m = await repos.manager.findById(ctx.manager!.id)
                    await ctx.reply(`Your status: ${m?.online ? 'online' : 'offline'}`)
                },
                requires: [CAP_ManagerRepo],
            },
            {
                command: { command: 'setgreeting', description: 'Toggle startup greeting on/off', args: SetGreetingArgs },
                invokable: async function (this: CmdDispatcher<Ctx>, args: CmdArgumentProxy, ctx) {
                    const greeting = String(args.getOrThrow('greeting'))
                    const repos = this.requireRepos('setgreeting')
                    await repos.manager.updateById(ctx.manager!.id, { useGreeting: greeting === 'on' })
                    await ctx.reply(`Startup greeting set to: ${greeting}`)
                },
                requires: [CAP_ManagerRepo],
            },
            {
                command: { command: 'wipe_chat', description: 'Delete every message of yours the bot recorded' },
                invokable: async function (this: CmdDispatcher<Ctx>, _args: CmdArgumentProxy, ctx, uiImpl) {
                    const userId = String(ctx.manager!.userId)
                    const result = uiImpl.wipeUserMessages
                        ? await uiImpl.wipeUserMessages(userId)
                        : { deleted: 0, failed: 0 }
                    await this.destroyAllDashboards(userId)
                    await ctx.reply(
                        `${UiUnicodeSymbols.success} Chat wiped: ${result.deleted} deleted, ${result.failed} skipped.`,
                    )
                },
                requires: [CAP_ManagerRepo],
            },
        ])
    }
}
