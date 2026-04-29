import { BuiltInUiCommandsEnum } from "../constants"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdArgumentProxy } from "../arg-proxy"
import { CmdDispatcher } from "../dispatcher"
import { CmdArgument } from "../../../ui/types/command"
import { UiUnicodeSymbols } from "../../../ui"

class DashboardArgs {
    @CmdArgument({
        required: false,
        position: 1,
        description: "Service name to show dashboard for",
    })
    service?: string
}

export const DashboardCommand: BuiltInCommand = {
    command: BuiltInUiCommandsEnum.DASHBOARD,
    description: "Show, foreground, or close a service dashboard",
    args: DashboardArgs,
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const userId = String(ctx.manager!.userId)
        const serviceName = args.getPos(1)

        if (!serviceName) {
            const dashboards = this.listUserDashboards(userId)
            if (dashboards.length === 0) {
                await ctx.reply(`${UiUnicodeSymbols.info} No active dashboards.`)
                return
            }

            let text = `${UiUnicodeSymbols.gear} Active dashboards:\n`
            for (const { serviceName: name, dashboard } of dashboards) {
                const status = dashboard.isAttached
                    ? `${UiUnicodeSymbols.success} live`
                    : `${UiUnicodeSymbols.info} ended`
                text += ` ${UiUnicodeSymbols.arrowRight} ${name}  [${status}]\n`
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
