import { CmdArgument, ICmdService, isService, IUICommandProcessed, CommandMetadata } from "../../../ui/types/command"
import { BuiltInHelpCommandsEnum } from "../constants"
import { CmdDispatcher } from "../dispatcher"
import { BuiltInCommand } from "../types/built-in-cmd"
import { IUICommandEntry } from "../types"
import { anyToString } from "@cmd-hub/common"
import { BaseUIContext, UiUnicodeSymbols } from "../../../ui"
import { CmdArgumentProxy } from "../arg-proxy"
import { TableDesigner } from "@cmd-hub/common"

const designer = new TableDesigner()
const DEFAULT_WIDTH = 72

function metadataToRows(meta: CommandMetadata): string[][] {
    return Object.entries(meta).map(([name, desc]) => [
        name,
        desc.required ? 'yes' : 'no',
        desc.description ?? '',
    ])
}

export const serviceToString = <Ctx extends BaseUIContext>(cmdName: string, cmdCb: IUICommandEntry<Ctx>, maxWidth?: number) => {
    const w = maxWidth ?? DEFAULT_WIDTH
    const executor = cmdCb.invokable as ICmdService
    let text = `Service /${cmdName}\n  ${cmdCb.description}\n\n`

    const configRows = metadataToRows(executor.configDescriptor())
    if (configRows.length > 0) {
        text += designer.make({
            title: 'Config',
            header: ['Name', 'Req', 'Description'],
            body: configRows,
        }, w)
    }

    const paramRows = metadataToRows(executor.paramsDescriptor())
    if (paramRows.length > 0) {
        text += designer.make({
            title: 'Params',
            header: ['Name', 'Req', 'Description'],
            body: paramRows,
        }, w)
    }

    text += `Next: ${cmdCb.next?.join(", ") ?? "None"}\n`
    text += `Prev: ${cmdCb.prev ?? "None"}\n`
    return text
}

export const commonToString = <Ctx extends BaseUIContext>(cmdName: string, cmdCb: IUICommandEntry<Ctx>, maxWidth?: number) => {
    const w = maxWidth ?? DEFAULT_WIDTH
    let text = `Command /${cmdName}\n  ${cmdCb.description}\n\n`

    if (cmdCb.args && cmdCb.args.length > 0) {
        text += designer.make({
            title: 'Arguments',
            header: ['Name', 'Req', 'Description'],
            body: cmdCb.args.map(a => [
                a.name,
                a.required ? 'yes' : 'no',
                a.description ?? '',
            ]),
        }, w)
    }

    text += `Next: ${cmdCb.next?.join(", ") ?? `${UiUnicodeSymbols.cross} None`}\n`
    text += `Prev: ${cmdCb.prev ?? `${UiUnicodeSymbols.cross} None`}\n`
    return text
}

export const uiCommandsToString = (commands: IUICommandProcessed[], maxWidth?: number): string => {
    const w = maxWidth ?? DEFAULT_WIDTH
    const body = commands.map(v => [
        `/${v.command}`,
        v.description ?? '',
    ])
    return designer.make({
        title: `${UiUnicodeSymbols.gear} Available commands`,
        header: ['Command', 'Description'],
        body,
    }, w)
}

/////////////////////////

const CommonHelp: BuiltInCommand = {
    command: BuiltInHelpCommandsEnum.HELP_COMMAND,
    description: "List all available commands.",
    invokable: async function(this: CmdDispatcher<any>, _, ctx) {
        const w = ctx.manager?.messageWidth ?? undefined
        const commands = this.toUICommands()
        const commandsStr = uiCommandsToString(commands, w)
        await ctx.reply(`<pre>${commandsStr}</pre>`, { parse_mode: 'HTML' })
    }
}

/////////////////////////

class ConcreetHelpArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Command name",
        defaultValue: "help",
        pairOptions: async (_: string, handler: CmdDispatcher<any>) => {
            return handler.toUICommands().map(c => c.command)
        }
    })
    command!: String
}

const ConcreetHelp: BuiltInCommand = {
    command: BuiltInHelpCommandsEnum.CHELP_COMMAND,
    description: "Print help for concreet command",
    args: ConcreetHelpArgs,
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const command = args.getOrThrow('command')

        try {
            const w = ctx.manager?.messageWidth ?? undefined
            const cb = this.getInvokable(command)
            const commandHelpStr = isService(cb.invokable) ? serviceToString(command, cb, w) : commonToString(command, cb, w)
            await ctx.reply(`<pre>${commandHelpStr}</pre>`, { parse_mode: 'HTML' })
        } catch(e: unknown) {
            if (e && typeof e === 'object' && 'success' in e && 'text' in e && typeof (e as { text: unknown }).text === 'string') {
                await ctx.reply((e as { text: string }).text)
            }
            await ctx.reply(`${UiUnicodeSymbols.error} Unknown error:\n -- ${anyToString(e)}`)
        }
    }
}

/////////////////////////

export {
    CommonHelp,
    ConcreetHelp,
}
