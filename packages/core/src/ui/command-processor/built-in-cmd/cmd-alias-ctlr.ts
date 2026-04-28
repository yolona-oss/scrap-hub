import { CmdArgument } from "../../../ui/types/command"
import { BuiltInAliasCommandsEnum } from "../constants"
import { CmdDispatcher } from "../dispatcher"
import { BuiltInCommand } from "../types/built-in-cmd"
import { UiUnicodeSymbols } from "../../../ui"
import { CmdArgumentProxy } from "../arg-proxy"
import { CAP_CmdAliasRepo } from "@cmd-hub/common"

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
    alias?: string

    @CmdArgument({
        required: true,
        position: 2,
        description: "Command to alias",
    })
    command?: string
}

const AliasCommand: BuiltInCommand = {
    command: BuiltInAliasCommandsEnum.ALIAS_COMMAND,
    description: "Print help for concreet command",
    args: AliasArgs,
    requires: [CAP_CmdAliasRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const aliasName = args.getOrThrow('alias')
        const commandStr = args.getOrThrow('command')

        const ownerId = ctx.manager!.id
        const repo = this.requireRepos('alias').cmdAlias

        if (!isValidAliasName(aliasName)) {
            throw new Error(`Alias name "${aliasName}" is not valid. It must be alphanumeric, numeric and underscore only`)
        }
        if (aliasName.length > MAX_ALIAS_NAME_LEN) {
            throw new Error(`Alias name "${aliasName}" is too long. Max length is ${MAX_ALIAS_NAME_LEN}`)
        }

        const existing = await repo.findByOwnerAndAlias(ownerId, aliasName)
        if (existing) {
            throw new Error(`Alias "${aliasName}" already exists`)
        }
        await repo.create({ alias: aliasName, command: commandStr, ownerId })
    }
}

class UnAliasArgs {
    @CmdArgument({
        required: true,
        position: 1,
        description: "Alias name to remove",
    })
    alias?: string
}

const UnaliasCommand: BuiltInCommand = {
    command: BuiltInAliasCommandsEnum.UNALIAS_COMMAND,
    description: "Unalias command",
    args: UnAliasArgs,
    requires: [CAP_CmdAliasRepo],
    invokable: async function(this: CmdDispatcher<any>, args: CmdArgumentProxy, ctx) {
        const aliasName = args.getOrThrow('alias')
        const ownerId = ctx.manager!.id
        const repo = this.requireRepos('unalias').cmdAlias

        const deletedCount = await repo.deleteByOwnerAndAlias(ownerId, aliasName)
        if (deletedCount === 0) {
            throw new Error(`Alias "${aliasName}" not found`)
        }
        await ctx.reply(`Alias "${aliasName}" removed`)
    }
}

const ListAliases: BuiltInCommand = {
    command: BuiltInAliasCommandsEnum.LIST_ALIASES_COMMAND,
    description: "Show all user aliases",
    requires: [CAP_CmdAliasRepo],
    invokable: async function(this: CmdDispatcher<any>, _, ctx) {
        const ownerId = ctx.manager!.id
        const repo = this.requireRepos('listAliases').cmdAlias

        const aliases = await repo.listByOwner(ownerId)
        const aliasesStr = `Aliases for user "${ownerId}":\n` +
            aliases.map(a => ` -- <${a.alias}>: ${UiUnicodeSymbols.gear} "${a.command}"`).join("\n")
        await ctx.reply(aliasesStr)
    }
}

export {
    AliasCommand,
    UnaliasCommand,
    ListAliases
}
