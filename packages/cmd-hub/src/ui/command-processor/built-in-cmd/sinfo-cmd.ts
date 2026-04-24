import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { CmdArgument } from "@core/ui/types/command"
import { UiUnicodeSymbols } from "@core/ui"
import { Account, Manager, IManager } from "@core/db"
import { TableDesigner } from "@core/utils/table-designer"

class SInfoArgs {
    @CmdArgument({
        required: false,
        position: 1,
        description: "Service name",
        pairOptions: async (_: string, handler: CmdDispatcher<any>, owner: IManager) => {
            return handler.UserActiveServices(String(owner.userId)).map(s => s.name)
                .concat(handler.getRegistredServiceNames())
                .filter((v: string, i: number, a: string[]) => a.indexOf(v) === i) // unique
        }
    })
    service?: string
}

function flattenObject(obj: any, prefix = '', maxDepth = 3, depth = 0): { key: string, value: string }[] {
    const result: { key: string, value: string }[] = []
    if (depth >= maxDepth) {
        result.push({ key: prefix || '(root)', value: typeof obj === 'object' ? '{...}' : String(obj) })
        return result
    }
    for (const key in obj) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        const val = obj[key]
        if (val && typeof val === 'object' && !Array.isArray(val)) {
            result.push(...flattenObject(val, fullKey, maxDepth, depth + 1))
        } else if (Array.isArray(val)) {
            result.push({ key: fullKey, value: `[${val.length} items]` })
        } else {
            result.push({ key: fullKey, value: String(val ?? '(empty)') })
        }
    }
    return result
}

export const SInfoCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.SINFO,
    description: "Show service runtime data, saved config, and session state",
    args: new SInfoArgs,
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const userId = String(ctx.manager!.userId)
        const serviceName = args.getPos(1) ?? args.get('service')

        if (!serviceName) {
            await ctx.reply(`${UiUnicodeSymbols.info} Usage: /sinfo <service>`)
            return
        }

        const owner = await Manager.findOne({ userId: ctx.manager!.userId })
        if (!owner) { await ctx.reply(`${UiUnicodeSymbols.error} Manager not found`); return }
        const account = await Account.findById(owner.account)
        if (!account) { await ctx.reply(`${UiUnicodeSymbols.error} Account not found`); return }

        const designer = new TableDesigner()
        const w = (ctx.manager as any)?.messageWidth ?? 72

        let text = `${UiUnicodeSymbols.gear} Service info: ${serviceName}\n`

        // Runtime state (if active)
        const activeService = this.UserActiveServices(userId).find(s => s.name === serviceName)
        if (activeService) {
            text += `${UiUnicodeSymbols.success} Status: RUNNING | Session: ${activeService.SessionId}\n\n`

            const cfgFields = flattenObject((activeService as any).data?.config ?? {})
            if (cfgFields.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.gear} Runtime config`,
                    header: ['Key', 'Value'],
                    body: cfgFields.map(f => [f.key, f.value]),
                }, w)
            }

            const paramFields = flattenObject((activeService as any).data?.params ?? {})
            if (paramFields.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.magnifierGlass} Runtime params`,
                    header: ['Key', 'Value'],
                    body: paramFields.map(f => [f.key, f.value]),
                }, w)
            }

            const sessFields = flattenObject((activeService as any).data?.sessionData ?? {})
            if (sessFields.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.clock} Session data`,
                    header: ['Key', 'Value'],
                    body: sessFields.map(f => [f.key, f.value]),
                }, w)
            }
        } else {
            text += `${UiUnicodeSymbols.info} Status: NOT RUNNING\n\n`
        }

        // Saved DB data
        try {
            const { account_module } = await account.getModuleByNameOrCreate(serviceName)
            const moduleData = account_module.data ?? {}

            const dbCfg = flattenObject(moduleData.config ?? {})
            if (dbCfg.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.lock} DB module config`,
                    header: ['Key', 'Value'],
                    body: dbCfg.map(f => [f.key, f.value]),
                }, w)
            } else {
                text += `${UiUnicodeSymbols.lock} DB module config: (empty)\n`
            }

            const sessions = await account_module.getSessions()
            if (sessions.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.clock} DB sessions`,
                    header: ['Session', 'Fields'],
                    body: sessions.map(sess => {
                        const sessData = flattenObject(sess.data ?? {})
                        return [sess.name, String(sessData.length)]
                    }),
                }, w)
            }
        } catch (_) {
            text += `${UiUnicodeSymbols.info} No saved module data in DB.\n`
        }

        // Truncate if too long for Telegram
        if (text.length > 3900) {
            text = text.slice(0, 3897) + '...'
        }

        await ctx.reply(`<pre>${text}</pre>`, { parse_mode: 'HTML' })
    }
}
