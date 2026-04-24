import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { CmdArgument } from "../../../ui/types/command"
import { UiUnicodeSymbols } from "../../../ui"
import { ConfigRegistry } from "../../../config-registry"
import { TableDesigner } from "../../../utils/table-designer"

class ConfigArgs {
    @CmdArgument({
        required: false,
        position: 1,
        description: "Config module name",
        pairOptions: async () => ConfigRegistry.list()
    })
    module?: string

    @CmdArgument({
        required: false,
        position: 2,
        description: "Config key to set"
    })
    key?: string

    @CmdArgument({
        required: false,
        position: 3,
        description: "New value"
    })
    value?: string
}

function maskValue(value: any, sensitive: boolean): string {
    const str = String(value ?? '')
    if (sensitive && str.length > 6) {
        return str.slice(0, 3) + '...' + str.slice(-3)
    }
    return str
}

export const ConfigCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.CONFIG,
    description: "View or edit app configuration",
    args: new ConfigArgs,
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const moduleName = args.getPos(1) ?? args.get('module')
        const key = args.getPos(2) ?? args.get('key')
        const value = args.getPos(3) ?? args.get('value')

        if (!moduleName) {
            // List all config modules
            const modules = ConfigRegistry.list()
            if (modules.length === 0) {
                await ctx.reply(`${UiUnicodeSymbols.info} No config modules registered.`)
                return
            }

            let text = `${UiUnicodeSymbols.gear} Config modules:\n`
            for (const name of modules) {
                const mod = ConfigRegistry.getModule(name)
                const fields = await ConfigRegistry.describe(name)
                text += ` ${UiUnicodeSymbols.arrowRight} ${name} [${mod?.scope ?? '?'}] (${fields.length} fields)\n`
            }
            text += `\nUse /config <module> to view, /config <module> <key> <value> to set.`
            await ctx.reply(text)
            return
        }

        if (!ConfigRegistry.has(moduleName)) {
            await ctx.reply(`${UiUnicodeSymbols.error} Unknown config module "${moduleName}". Use /config to list modules.`)
            return
        }

        if (key && value) {
            if (!ctx.manager?.isAdmin) {
                await ctx.reply(`${UiUnicodeSymbols.error} Admin access required to modify config`)
                return
            }
            const mod = ConfigRegistry.getModule(moduleName)
            const userId = String(ctx.manager!.userId)
            await ConfigRegistry.set(moduleName, key, value, mod?.scope === 'user' ? userId : undefined)
            const target = mod?.scope === 'bootstrap' ? 'config.json' : 'MongoDB'
            await ctx.reply(`${UiUnicodeSymbols.success} Set ${moduleName}.${key} = "${value}" (saved to ${target})`)
            return
        }

        // Show module config
        const userId = String(ctx.manager!.userId)
        const fields = await ConfigRegistry.describe(moduleName, userId)
        if (fields.length === 0) {
            await ctx.reply(`${UiUnicodeSymbols.info} Module "${moduleName}" has no config fields.`)
            return
        }

        const designer = new TableDesigner()
        const table = designer.make({
            title: `${UiUnicodeSymbols.gear} ${moduleName} config`,
            header: ['Key', 'Value'],
            body: fields.map(({ key: k, value: v, sensitive }) => [k, maskValue(v, sensitive)]),
        }, (ctx.manager as any)?.messageWidth ?? 72)

        await ctx.reply(`<pre>${table}</pre>Use /config ${moduleName} &lt;key&gt; &lt;value&gt; to update.`, { parse_mode: 'HTML' })
    }
}
