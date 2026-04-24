import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { CmdArgument } from "@core/ui/types/command"
import { UiUnicodeSymbols } from "@core/ui"
import { IManager } from "@core/db"

class DashboardArgs {
    @CmdArgument({
        required: false,
        position: 1,
        description: "Service name to show dashboard for",
        // Common's CmdArgumentOptionSetter default is (any, any) to avoid
        // dragging CmdDispatcher/IManager into common. Annotate to restore
        // inference on `.map(s => s.name)`.
        pairOptions: async (_: string, handler: CmdDispatcher<any>, owner: IManager) => {
            return handler.UserActiveServices(String(owner.userId)).map(s => s.name)
        }
    })
    service?: string
}

export const DashboardCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.DASHBOARD,
    description: "Show, foreground, or close a service dashboard",
    args: new DashboardArgs,
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const userId = String(ctx.manager!.userId)
        const serviceName = args.getPos(1)

        if (!serviceName) {
            // List all active services with dashboard status
            const active = this.UserActiveServices(userId)
            if (active.length === 0) {
                await ctx.reply(`${UiUnicodeSymbols.info} No active services.`)
                return
            }

            let text = `${UiUnicodeSymbols.gear} Active services:\n`
            for (const s of active) {
                const dash = this.getDashboard(userId, s.name)
                const status = dash
                    ? dash.isAttached
                        ? `${UiUnicodeSymbols.success} dashboard live`
                        : `${UiUnicodeSymbols.info} dashboard ended`
                    : `${UiUnicodeSymbols.warning} no dashboard`
                text += ` ${UiUnicodeSymbols.arrowRight} ${s.name}  [${status}]\n`
            }
            text += `\nUse /dashboard <name> to foreground a dashboard.`
            await ctx.reply(text)
            return
        }

        const dashboard = this.getDashboard(userId, serviceName)
        if (dashboard) {
            // Re-send dashboard to foreground (new message at bottom of chat)
            await dashboard.reattach()
        } else {
            await ctx.reply(`${UiUnicodeSymbols.warning} No dashboard for "${serviceName}". Service may not be running or was started with -noDashboard.`)
        }
    }
}
