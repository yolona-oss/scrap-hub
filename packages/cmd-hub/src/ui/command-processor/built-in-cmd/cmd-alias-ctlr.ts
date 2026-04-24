import { CmdArgument } from "../../../ui/types/command"
import { BuiltInAliasCommandsEnum } from "../constants"
import {CmdDispatcher } from "../dispatcher"
import { BuiltInCommand } from "../types/built-in-cmd"
import { CmdAlias } from "../../../db"
import { UiUnicodeSymbols } from "../../../ui"
import { CmdArgumentProxy } from "../arg-proxy"

export const MAX_ALIAS_NAME_LEN = 32

function isValidAliasName(alias: string) {
    return /^[a-zA-Z0-9_]+$/.test(alias)
}

class AliasArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Alias name",
    })
    alias!: String

    @CmdArgument({
        required: true,
        position: 2,
        description: "Command to alias",
    })
    command!: String
}

const AliasCommand: BuiltInCommand = {
    command: BuiltInAliasCommandsEnum.ALIAS_COMMAND,
    description: "Print help for concreet command",
    args: AliasArgs,
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const aliasName = args.getOrThrow('alias')
        const commandStr = args.getOrThrow('command')

        const owner_id = ctx.manager!._id

        if (!isValidAliasName(aliasName)) {
            throw new Error(`Alias name "${aliasName}" is not valid. It must be alphanumeric, numeric and underscore only`)
        }
        if (aliasName.length > MAX_ALIAS_NAME_LEN) {
            throw new Error(`Alias name "${aliasName}" is too long. Max length is ${MAX_ALIAS_NAME_LEN}`)
        }

        const aliases = await CmdAlias.find({owner_id})
        if (aliases.find(a => a.alias === aliasName)) {
            throw new Error(`Alias "${aliasName}" already exists`)
        }
        console.log(aliasName, "|", commandStr)
        await CmdAlias.create({alias: aliasName, command: commandStr, owner_id})
    }
}

class UnAliasArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Alias name to remove",
    })
    alias!: String
}

const UnaliasCommand: BuiltInCommand = {
    command: BuiltInAliasCommandsEnum.UNALIAS_COMMAND,
    description: "Unalias command",
    args: UnAliasArgs,
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const aliasName = args.getOrThrow('alias')
        const owner_id = ctx.manager!._id

        const res = await CmdAlias.deleteOne({alias: aliasName, owner_id})
        if (res.deletedCount === 0) {
            throw new Error(`Alias "${aliasName}" not found`)
        } else {
            await ctx.reply(`Alias "${aliasName}" removed`)
        }
    }
}

const ListAliases: BuiltInCommand = {
    command: BuiltInAliasCommandsEnum.LIST_ALIASES_COMMAND,
    description: "Show all user aliases",
    args: [],
    invokable: async function(this: CmdDispatcher<any>, _, ctx) {
        const owner_id = ctx.manager!._id

        const aliases = await CmdAlias.find({owner_id})
        const aliasesStr = `Aliases for user "${owner_id}":\n` +
            aliases.map(a => ` -- <${a.alias}>: ${UiUnicodeSymbols.gear} "${a.command}"`).join("\n")
        await ctx.reply(aliasesStr)
    }
}

export {
    AliasCommand,
    UnaliasCommand,
    ListAliases
}
