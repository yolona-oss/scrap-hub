import { CmdArgument } from "../../../ui/types/command"
import { BuiltInAccountCommandsEnum } from "../constants"
import log from '../../../application/logger'
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdDispatcher } from "../dispatcher"

import "reflect-metadata"
import { extractValueFromObject } from "@cmd-hub/common"
import { UiUnicodeSymbols } from "../../../ui"
import { CmdArgumentProxy } from "../arg-proxy"
import { isValidConfigPath } from "@cmd-hub/common"
import { CAP_ManagerRepo, CAP_AccountRepo, type IAccountRepo } from "@cmd-hub/common"

async function listModuleNames(repo: IAccountRepo, accountId: string): Promise<string[]> {
    const account = await repo.handleById(accountId)
    if (!account) {
        log.error(`account-ctrl: account ${accountId} not found`)
        return []
    }
    const modules = await account.getModules()
    return modules.map(m => m.record.name)
}

/** Helper called by `pairOptions` callbacks to grab the dispatcher's repos
 *  bag at autocomplete time. */
async function listModuleNamesViaDispatcher(
    dispatcher: CmdDispatcher<any>,
    accountId: string | null,
): Promise<string[]> {
    if (!accountId) return []
    const repos = dispatcher.repos
    if (!repos) return []
    return listModuleNames(repos.account, accountId)
}

class SetVariableArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Module name",
        pairOptions: async (_, handler) => {
            return handler.getRegistredServiceNames()
        }
    })
    module!: String

    @CmdArgument({
        required: true,
        description: "Variable path",
        position: 2,
        pairOptions: []
    })
    path!: String

    @CmdArgument({
        required: true,
        position: 3,
        description: "Variable value",
        pairOptions: []
    })
    value!: String
}

const SetVariableCommand: BuiltInCommand = {
    command: BuiltInAccountCommandsEnum.SET_VARIABLE,
    description: "Create or update variable for user execution context",
    args: SetVariableArgs,
    requires: [CAP_ManagerRepo, CAP_AccountRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const repos = this.requireRepos('setVariable')
        const userId = String(ctx.manager!.userId)
        const owner = await repos.manager.findByUserId(userId)
        if (!owner?.accountId) {
            throw new Error(`Account not found. User: ${userId}`)
        }
        const account = await repos.account.handleById(owner.accountId)
        if (!account) {
            throw new Error(`Account ${owner.accountId} not found. User: ${userId}`)
        }

        const moduleName = args.getOrThrow('module')
        const path = args.getOrThrow('path')
        const value = args.getOrThrow('value')

        if (!isValidConfigPath(path)) {
            await ctx.reply(`${UiUnicodeSymbols.error} Invalid path: "${path}"`)
            return
        }
        const { module } = await account.getModuleByNameOrCreate(moduleName)
        await module.setDataPath(path, value)
        await ctx.reply(`Variable "${path}" set to "${value}" on module "${moduleName}"`)
    }
}

class RemoveVariableArgs {
    @CmdArgument({
        required: true,
        description: "Module name",
        position: 1,
        pairOptions: async (_, dispatcher, owner) => {
            return listModuleNamesViaDispatcher(dispatcher, owner.accountId)
        }
    })
    module!: String

    @CmdArgument({
        required: true,
        description: "Variable path",
        position: 2,
        pairOptions: []
    })
    path!: String
}

const RemoveVariableCommand: BuiltInCommand = {
    command: BuiltInAccountCommandsEnum.REMOVE_VARIABLE,
    description: "Remove variable for user execution context",
    args: RemoveVariableArgs,
    requires: [CAP_ManagerRepo, CAP_AccountRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const repos = this.requireRepos('removeVariable')
        const userId = String(ctx.manager!.userId)
        const owner = await repos.manager.findByUserId(userId)
        if (!owner?.accountId) {
            throw new Error(`${UiUnicodeSymbols.error} Account not found.\nUser: ${UiUnicodeSymbols.user} "${userId}"`)
        }
        const account = await repos.account.handleById(owner.accountId)
        if (!account) {
            throw new Error(`${UiUnicodeSymbols.error} Account "${owner.accountId}" ${UiUnicodeSymbols.magnifierGlass} not found.\nUser: ${UiUnicodeSymbols.user} "${userId}"`)
        }

        const moduleName = args.getOrThrow('module')
        const path = args.getOrThrow('path')

        const module = await account.getModuleByName(moduleName)
        if (!module) {
            throw new Error(`${UiUnicodeSymbols.error} Module "${moduleName}" ${UiUnicodeSymbols.magnifierGlass} not found.`)
        }
        await module.setDataPath(path, undefined)
        await ctx.reply(`Field ${UiUnicodeSymbols.arrowRight} "${path}" removed`)
    }
}

class GetVariableArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Module name",
        pairOptions: async (_, dispatcher, owner) => {
            return listModuleNamesViaDispatcher(dispatcher, owner.accountId)
        }
    })
    module!: String

    @CmdArgument({
        required: true,
        position: 2,
        description: "Variable path",
        pairOptions: []
    })
    path!: String
}

const GetVariableCommand: BuiltInCommand = {
    command: BuiltInAccountCommandsEnum.GET_VARIABLE,
    description: "Get variable for user execution context",
    args: GetVariableArgs,
    requires: [CAP_ManagerRepo, CAP_AccountRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const repos = this.requireRepos('getVariable')
        const userId = String(ctx.manager!.userId)
        const owner = await repos.manager.findByUserId(userId)
        if (!owner?.accountId) {
            throw new Error(`Account not found. User: ${userId}`)
        }
        const account = await repos.account.handleById(owner.accountId)
        if (!account) {
            throw new Error(`Account ${owner.accountId} not found. User: ${userId}`)
        }

        const moduleName = args.getOrThrow('module')
        const path = args.getOrThrow('path')

        const module = await account.getModuleByName(moduleName)
        if (!module) {
            throw new Error(`Module ${UiUnicodeSymbols.arrowRight} "${moduleName}" not found`)
        }

        const value = extractValueFromObject(module.record.data, path)
        await ctx.reply(`${UiUnicodeSymbols.magnifierGlass} Data found: "${path}" = "${value}"`)
    }
}

export {
    SetVariableCommand,
    RemoveVariableCommand,
    GetVariableCommand,
}
