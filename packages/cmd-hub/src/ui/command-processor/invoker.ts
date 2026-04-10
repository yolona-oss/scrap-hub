import { BaseUIContext, ICmdFunction, ICmdService, ICommandCompiled, isFunc, IUI, UiUnicodeSymbols } from "@core/ui"
import {CmdDispatcher } from "./dispatcher"
import { IArgumentCompiled } from "@core/ui/types"
import log from '@logger';
import { anyToString } from "@core/utils/misc"
import { IHandleResult } from "./types";
import { ServiceDashboard } from "./dashboard";

const SEND_SUCCESS = false

export class CommandInvoker<TContext extends BaseUIContext> {
    constructor(
        protected dispatcher: CmdDispatcher<TContext>,
    ) { }

    async invoke(invokerId: string, cmdCompiled: ICommandCompiled, ctx: TContext, uiImpl: IUI<TContext>): Promise<IHandleResult> {
        log.trace(`Command invoker: Invoking command: ${cmdCompiled.command}, invoker: ${invokerId}`)
        const { command } = cmdCompiled
        const cb = this.dispatcher.getInvokable(command)
        if (isFunc(cb.invokable)) {
            return await this.invokeFunc(invokerId, cmdCompiled, ctx, uiImpl)
        } else {
            return await this.invokeService(invokerId, cmdCompiled, ctx, uiImpl)
        }
    }

    async invokeFunc(_: string, { command, proxy }: ICommandCompiled, ctx: TContext, uiImpl: IUI<TContext>): Promise<IHandleResult> {
        const cb = this.dispatcher.getInvokable(command)

        try {
            let exec = cb.invokable as ICmdFunction<TContext>
            if (this.dispatcher.isBuiltInCommand(command)) {
                exec = exec.bind(this.dispatcher)
            }
            const res = await exec(proxy, ctx, uiImpl)
            if (res?.error) {
                log.error(`Command "${command}" invokation error: ${res.error}`)
                return {
                    success: false,
                    markup: {
                        text: `${UiUnicodeSymbols.error} Invokation failed: "${res.error ?? "unknown error"}"`
                    },
                    messageType: 'system' as const
                }
            } else {
                log.info(`Command "${command}" invokation success`)
                return {
                    success: true,
                    markup: {
                        text: SEND_SUCCESS ? `${UiUnicodeSymbols.success} Invokation success` : ""
                    }
                }
            }
        } catch (e: any) {
            log.error(`Command ${command} invokation error: ${anyToString(e)}\n`, e)
            return {
                success: false,
                markup: {
                    text: `Command invokation error:\n ${anyToString(e)}`
                },
                messageType: 'system' as const
            }
        }
    }

    private compiledArgToInvokeArg(readArgs: IArgumentCompiled[]) {
        const _conf = readArgs.filter(a => a.ctx === 'config')
        let config: any = {}
        for (const c of _conf) {
            config = Object.assign(config, { [c.name]: c.value })
        }

        const _params = readArgs.filter(a => a.ctx === "params")
        let params: any = {}
        for (const p of _params) {
            params = Object.assign(params, { [p.name]: p.value })
        }

        const _msgs = readArgs.filter(a => a.ctx === "message")
        let messages: any = {}
        for (const m of _msgs) {
            messages = Object.assign(messages, { [m.name]: m.value })
        }

        return {
            config,
            params,
            messages
        }
    }

    async invokeService(userId: string, { command: serviceName, raw: readArgs }: ICommandCompiled, ctx: TContext, uiImpl: IUI<TContext>): Promise<IHandleResult> {
        if (this.dispatcher.isServiceActive(userId, serviceName)) {
            return {
                success: false,
                markup: {
                    text: `${UiUnicodeSymbols.warning} Service ${UiUnicodeSymbols.arrowRight} "${serviceName}" already active.`
                },
                messageType: 'system' as const
            }
        }

        const cb = this.dispatcher.getInvokable(serviceName)
        if (!cb || (isFunc(cb.invokable))) {
            return {
                success: false,
                markup: {
                    text: `${UiUnicodeSymbols.error} Command service ${UiUnicodeSymbols.arrowRight} "${serviceName}" not found.`
                },
                messageType: 'system' as const
            }
        }
        const exe = cb.invokable as ICmdService

        const { config, params, messages } = this.compiledArgToInvokeArg(readArgs)

        const inputData = {
            config,
            params,
            messages
        }
        log.trace(`----Invoke-args\n
config:   ${JSON.stringify(config, null, 2)}
params:   ${JSON.stringify(params, null, 2)}
messages: ${JSON.stringify(messages, null, 2)}`)

        const serviceInstance = exe.clone(userId, inputData)
        const userServices = this.dispatcher.UserActiveServices(userId)
        const useDashboard = !params.noDashboard

        log.info("-- Starting service: " + serviceInstance.name)

        try {
            await serviceInstance.Initialize()
            userServices.push(serviceInstance)

            // Always clean up active services list on done
            serviceInstance.on('done', () => {
                try {
                    this.dispatcher.RemoveUserActiveService(userId, serviceName)
                } catch (_) {}
                log.info("-- Service done: " + serviceName)
            })

            // Handle file export events — send document to user
            serviceInstance.on('file' as any, async (filePath: string) => {
                try {
                    const fs = await import('fs')
                    if (fs.existsSync(filePath)) {
                        const path = await import('path')
                        await uiImpl.sendMessage(userId, `Sending file: ${path.basename(filePath)}`)
                        // Use raw bot API for file sending (not available in IUI abstraction)
                        const bot = (uiImpl as any).bot
                        if (bot?.telegram?.sendDocument) {
                            await bot.telegram.sendDocument(userId, { source: filePath })
                            log.info(`Sent file ${filePath} to user ${userId}`)
                        }
                    }
                } catch (e: any) {
                    log.error(`Failed to send file ${filePath}: ${anyToString(e)}`)
                }
            })

            if (useDashboard) {
                // Create and attach dashboard
                const maxWidth = ctx.manager?.messageWidth ?? uiImpl.max_message_width()
                const dashboard = new ServiceDashboard(uiImpl, userId, serviceInstance, maxWidth)
                dashboard.bindService()
                await dashboard.attach()
                this.dispatcher.setDashboard(userId, serviceName, dashboard as any)
            } else {
                // Fallback: plain reply events — tracked through sendMessage
                serviceInstance.on("message", async (message: string) => {
                    try {
                        await uiImpl.sendMessage(userId, message)
                    } catch (e: any) {
                        log.debug(`Service ${serviceName} message send failed: ${anyToString(e)}`)
                    }
                })
                serviceInstance.on('done', async (msg: string = "") => {
                    msg = msg.length > 0 ? msg : `${UiUnicodeSymbols.info} - ${msg}`
                    try {
                        await uiImpl.sendMessage(userId, `${UiUnicodeSymbols.success} Service ${UiUnicodeSymbols.arrowRight} "${serviceName}" done.\n${msg}`)
                    } catch (e: any) {
                        log.debug(`Service ${serviceName} done message send failed: ${anyToString(e)}`)
                    }
                })
            }

            // Fire-and-forget: don't await — services may run indefinitely.
            serviceInstance.run().catch(async (e: any) => {
                this.dispatcher.RemoveUserActiveService(userId, serviceName)
                log.error(`Service ${serviceName} runtime error: ${anyToString(e)}`, e)
                try {
                    await uiImpl.sendMessage(userId, `${UiUnicodeSymbols.error} Service ${UiUnicodeSymbols.arrowRight} "${serviceName}" failed:\n -- ${UiUnicodeSymbols.warning} ${anyToString(e)}`)
                } catch (_) {}
            })
            return {
                success: true,
                markup: {
                    text: useDashboard ? '' : `Service ${UiUnicodeSymbols.arrowRight} "${serviceName}" ${UiUnicodeSymbols.star} started.`
                },
                messageType: 'system' as const
            }
        } catch(e: any) {
            this.dispatcher.RemoveUserActiveService(userId, serviceName)
            log.error(`Error starting service ${serviceName}: ${anyToString(e)}`, e)
            return {
                success: false,
                markup: {
                    text: `${UiUnicodeSymbols.error} Error starting service ${UiUnicodeSymbols.arrowRight} "${serviceName}":\n -- ${UiUnicodeSymbols.warning} ${anyToString(e)}`
                },
                messageType: 'system' as const
            }
        }
    }
}
