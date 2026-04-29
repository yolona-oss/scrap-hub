import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { CmdArg } from "../../../ui/types/command"
import { UiUnicodeSymbols } from "../../../ui"
import { TableDesigner } from "@cmd-hub/common"
import { CAP_ManagerRepo, CAP_AccountRepo } from "@cmd-hub/common"

class SInfoArgs {
    @CmdArg({
        required: false,
        position: 1,
        description: 'Service name',
    })
    service?: string
}

function flattenObject(obj: unknown, prefix = '', maxDepth = 3, depth = 0): { key: string, value: string }[] {
    const result: { key: string, value: string }[] = []
    if (depth >= maxDepth) {
        result.push({ key: prefix || '(root)', value: typeof obj === 'object' ? '{...}' : String(obj) })
        return result
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return result
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        const fullKey = prefix ? `${prefix}.${key}` : key
        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
            result.push(...flattenObject(val, fullKey, maxDepth, depth + 1))
        } else if (Array.isArray(val)) {
            result.push({ key: fullKey, value: `[${val.length} items]` })
        } else {
            result.push({ key: fullKey, value: String(val ?? '(empty)') })
        }
    }
    return result
}

interface ServiceData {
    config?: Record<string, unknown>
    params?: Record<string, unknown>
    runtimeState?: Record<string, unknown>
}

export const SInfoCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.SINFO,
    description: "Show service runtime data, saved config, and session state",
    args: SInfoArgs,
    requires: [CAP_ManagerRepo, CAP_AccountRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const repos = this.requireRepos('sinfo')
        const userId = String(ctx.manager!.userId)
        const serviceName = args.getPos(1) ?? args.get('service')

        if (!serviceName) {
            await ctx.reply(`${UiUnicodeSymbols.info} Usage: /sinfo <service>`)
            return
        }

        const owner = await repos.manager.findByUserId(ctx.manager!.userId)
        if (!owner) { await ctx.reply(`${UiUnicodeSymbols.error} Manager not found`); return }
        if (!owner.accountId) { await ctx.reply(`${UiUnicodeSymbols.error} Manager has no account`); return }
        const account = await repos.account.handleById(owner.accountId)
        if (!account) { await ctx.reply(`${UiUnicodeSymbols.error} Account not found`); return }

        const designer = new TableDesigner()
        const w = ctx.manager?.messageWidth ?? 72

        let text = `${UiUnicodeSymbols.gear} Service info: ${serviceName}\n`

        // Runtime state (if active)
        const activeService = this.UserActiveServices(userId).find(s => s.name === serviceName)
        if (activeService) {
            text += `${UiUnicodeSymbols.success} Status: RUNNING | Session: ${activeService.SessionId}\n\n`

            const liveData = activeService.snapshot as ServiceData
            const cfgFields = flattenObject(liveData.config ?? {})
            if (cfgFields.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.gear} Runtime config`,
                    header: ['Key', 'Value'],
                    body: cfgFields.map(f => [f.key, f.value]),
                }, w)
            }

            const paramFields = flattenObject(liveData.params ?? {})
            if (paramFields.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.magnifierGlass} Runtime params`,
                    header: ['Key', 'Value'],
                    body: paramFields.map(f => [f.key, f.value]),
                }, w)
            }

            const stateFields = flattenObject(liveData.runtimeState ?? {})
            if (stateFields.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.clock} Runtime state`,
                    header: ['Key', 'Value'],
                    body: stateFields.map(f => [f.key, f.value]),
                }, w)
            }
        } else {
            text += `${UiUnicodeSymbols.info} Status: NOT RUNNING\n\n`
        }

        // Saved DB data
        try {
            const { module } = await account.getModuleByNameOrCreate(serviceName)
            const moduleData = module.record.data

            const dbCfg = flattenObject(moduleData.config ?? {})
            if (dbCfg.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.lock} Account-layer config (baseline)`,
                    header: ['Key', 'Value'],
                    body: dbCfg.map(f => [f.key, f.value]),
                }, w)
            } else {
                text += `${UiUnicodeSymbols.lock} Account-layer config: (empty)\n`
            }

            const sessions = await module.getSessions()
            if (sessions.length > 0) {
                text += designer.make({
                    title: `${UiUnicodeSymbols.clock} Session-layer overlays`,
                    header: ['Session', 'Config keys', 'State fields'],
                    body: sessions.map(sess => {
                        const sessConfig = flattenObject((sess.record.data?.config ?? {}) as Record<string, unknown>)
                        const sessState = flattenObject((sess.record.data?.runtimeState ?? {}) as Record<string, unknown>)
                        return [sess.record.name, String(sessConfig.length), String(sessState.length)]
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
