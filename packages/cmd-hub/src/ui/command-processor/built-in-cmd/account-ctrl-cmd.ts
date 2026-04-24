import { CmdArgument, IArgumentCompiled } from "../../../ui/types/command"
import { BuiltInAccountCommandsEnum } from "../constants"
import { Account, Manager } from "../../../db"
import log from '../../../application/logger';
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdDispatcher } from "../dispatcher"

import "reflect-metadata";
import { extractValueFromObject } from "../../../utils/object"
import { UiUnicodeSymbols } from "../../../ui"
import { CmdArgumentProxy } from "../arg-proxy";
import { isValidConfigPath } from "../../../utils/validation";

async function getAllUserModules(accountId: string): Promise<string[]> {
    const account = await Account.findById(accountId)
    if (!account) {
        log.error(`RemoveVarialbe::pairOptions Account ${accountId} not found`)
        return []
    }

    return (await account.getModules()).map(m => m.name)
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
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const userId = String(ctx.manager!.userId)
        const user = await Manager.findOne({userId: Number(userId)})
        const account = await Account.findById(user!.account)
        if (!account) {
            throw new Error(`Account ${user!.account} not found. User: ${userId}`)
        }

        const module_name = args.getOrThrow('module')
        const path = args.getOrThrow('path')
        const value = args.getOrThrow('value')

        if (!isValidConfigPath(path)) {
            await ctx.reply(`${UiUnicodeSymbols.error} Invalid path: "${path}"`)
            return
        }
        const { account_module } = await account.getModuleByNameOrCreate(module_name)
        account_module.set(`data.${path}`, value)
        await account_module.save()
        await ctx.reply(`Variable "${path}" set to "${value}" on module "${module_name}"`)
    }
}

/////////////////////////

class RemoveVariableArgs {
    @CmdArgument({
        required: true,
        description: "Module name",
        position: 1,
        pairOptions: async (_, __, owner) => {
            return await getAllUserModules(owner.account.toString())
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

/////////////////////////

const RemoveVariableCommand: BuiltInCommand = {
    command: BuiltInAccountCommandsEnum.REMOVE_VARIABLE,
    description: "Remove variable for user execution context",
    args: RemoveVariableArgs,
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const userId = String(ctx.manager!.userId)
        const user = await Manager.findOne({userId: Number(userId)})
        const account = await Account.findById(user!.account)
        if (!account) {
            throw new Error(`${UiUnicodeSymbols.error} Account "${user!.account}" ${UiUnicodeSymbols.magnifierGlass} not found.\nUser: ${UiUnicodeSymbols.user} "${userId}"`)
        }

        const module_name = args.getOrThrow('module')
        const path = args.getOrThrow('path')

        const account_module = await account.getModuleByName(module_name)
        if (!account_module) {
            throw new Error(`${UiUnicodeSymbols.error} Module "${module_name}" ${UiUnicodeSymbols.magnifierGlass} not found.`)
        }
        account_module.set(`data.${path}`, undefined)
        await account_module.save()
        await ctx.reply(`Field ${UiUnicodeSymbols.arrowRight} "${path}" removed`)
    }
}

class GetVariableArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Module name",
        pairOptions: async (_, __, owner) => {
            return await getAllUserModules(owner.account.toString())
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
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const userId = String(ctx.manager!.userId)
        const user = await Manager.findOne({userId: Number(userId)})
        const account = await Account.findById(user!.account)
        if (!account) {
            throw new Error(`Account ${user!.account} not found. User: ${userId}`)
        }

        const module_name = args.getOrThrow('module')
        const path = args.getOrThrow('path')

        const account_module = await account.getModuleByName(module_name)
        if (!account_module) {
            throw new Error(`Module ${UiUnicodeSymbols.arrowRight} "${module_name}" not found`)
        }

        const value = extractValueFromObject(account_module.data, path)

        await ctx.reply(`${UiUnicodeSymbols.magnifierGlass} Data found: "${path}" = "${value}"`)
    }
}

/////////////////////////

export {
    SetVariableCommand,
    RemoveVariableCommand,
    GetVariableCommand
}
