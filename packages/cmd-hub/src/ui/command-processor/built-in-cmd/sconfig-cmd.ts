import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { CmdArgument } from "../../../ui/types/command"
import { UiUnicodeSymbols } from "../../../ui"
import { TableDesigner } from "@cmd-hub/common"
import { isValidConfigPath } from "@cmd-hub/common"
import { CAP_ManagerRepo, CAP_AccountRepo } from '@cmd-hub/common'

class SConfigArgs {
    @CmdArgument({
        required: false,
        position: 1,
        description: "Service name",
        pairOptions: async (_, handler) => handler.getRegistredServiceNames()
    })
    service?: string

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

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Clear all saved config for the service"
    })
    clear?: string
}

function flattenObject(obj: unknown, prefix = ''): { key: string, value: unknown }[] {
    const result: { key: string, value: unknown }[] = []
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return result
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            result.push(...flattenObject(val, fullKey))
        } else {
            result.push({ key: fullKey, value: val })
        }
    }
    return result
}

function maskSensitive(key: string, value: unknown): string {
    const str = String(value ?? '')
    const sensitiveKeys = ['token', 'key', 'secret', 'password', 'apikey', 'authtoken', 'credentials']
    const isSensitive = sensitiveKeys.some(s => key.toLowerCase().includes(s))
    if (isSensitive && str.length > 6) {
        return str.slice(0, 3) + '...' + str.slice(-3)
    }
    return str
}

export const SConfigCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.SCONFIG,
    description: "View or edit saved service configs",
    args: new SConfigArgs,
    requires: [CAP_ManagerRepo, CAP_AccountRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const repos = this.requireRepos('sconfig')
        const serviceName = args.getPos(1) ?? args.get('service')
        const key = args.getPos(2) ?? args.get('key')
        const doClear = args.has('clear')

        // Extract raw value from message text: everything after the key is the value.
        // This supports JSON, multi-word strings, and other complex values.
        let value: string | undefined = args.getPos(3) ?? args.get('value')
        const rawText = (ctx as { text?: string }).text
        if (key && rawText) {
            const keyIdx = rawText.indexOf(key)
            if (keyIdx >= 0) {
                const rawValue = rawText.slice(keyIdx + key.length).trim()
                if (rawValue) value = rawValue
            }
        }

        const owner = await repos.manager.findByUserId(ctx.manager!.userId)
        if (!owner) {
            await ctx.reply(`${UiUnicodeSymbols.error} Manager not found`)
            return
        }
        if (!owner.accountId) {
            await ctx.reply(`${UiUnicodeSymbols.error} Manager has no account`)
            return
        }
        const account = await repos.account.handleById(owner.accountId)
        if (!account) {
            await ctx.reply(`${UiUnicodeSymbols.error} Account not found`)
            return
        }

        if (!serviceName) {
            // List all services with saved configs
            const serviceNames = this.getRegistredServiceNames()
            let text = `${UiUnicodeSymbols.gear} Saved service configs:\n`
            let hasAny = false

            for (const name of serviceNames) {
                try {
                    const { module } = await account.getModuleByNameOrCreate(name)
                    const config = (module.record.data.config ?? {}) as Record<string, unknown>
                    if (Object.keys(config).length > 0) {
                        const fields = flattenObject(config)
                        text += ` ${UiUnicodeSymbols.arrowRight} ${name} (${fields.length} fields)\n`
                        hasAny = true
                    }
                } catch (_) {}
            }

            if (!hasAny) {
                text += ` ${UiUnicodeSymbols.info} No saved configs yet. Start a service to create one.\n`
            }
            text += `\nUse /sconfig <service> to view details.`
            await ctx.reply(text)
            return
        }

        const { module } = await account.getModuleByNameOrCreate(serviceName)

        if (doClear) {
            await module.replaceConfig({})
            await ctx.reply(`${UiUnicodeSymbols.success} Cleared ${serviceName} config. Defaults will be used on next start.`)
            return
        }

        if (key && value) {
            if (!isValidConfigPath(key)) {
                await ctx.reply(`${UiUnicodeSymbols.error} Invalid config key: "${key}"`)
                return
            }
            // Parse JSON values so objects/arrays are stored natively in MongoDB
            let parsedValue: unknown = value
            try { parsedValue = JSON.parse(value) } catch (_) {}
            // Limit depth of parsed objects to prevent DoS
            if (typeof parsedValue === 'object' && JSON.stringify(parsedValue).length > 10000) {
                await ctx.reply(`${UiUnicodeSymbols.error} Value too large`)
                return
            }
            await module.setDataPath(`config.${key}`, parsedValue)
            const display = typeof parsedValue === 'object' ? JSON.stringify(parsedValue).slice(0, 100) : String(parsedValue)
            await ctx.reply(`${UiUnicodeSymbols.success} Set ${serviceName}.${key} = ${maskSensitive(key, display)}`)
            return
        }

        // Show config
        const config = (module.record.data.config ?? {}) as Record<string, unknown>
        if (Object.keys(config).length === 0) {
            await ctx.reply(`${UiUnicodeSymbols.info} No saved config for "${serviceName}". Start the service to create one.`)
            return
        }

        const fields = flattenObject(config)
        const designer = new TableDesigner()
        const table = designer.make({
            title: `${UiUnicodeSymbols.gear} ${serviceName} config`,
            header: ['Key', 'Value'],
            body: fields.map(({ key: k, value: v }) => [k, maskSensitive(k, v)]),
        }, ctx.manager?.messageWidth ?? 72)

        await ctx.reply(`<pre>${table}</pre>Use /sconfig ${serviceName} &lt;key&gt; &lt;value&gt; to update.`, { parse_mode: 'HTML' })
    }
}
