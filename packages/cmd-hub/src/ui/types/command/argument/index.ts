import { CommandArgumentKeyHolder } from './meta'

/**
 * @description Command argument definition
 *
 * use this notation: 
 * class CommandEchoArgs {
 *     @CmdArgument({
 *         required: true,
 *         description: "Message to echo",
 *     })
 *     echo?: string
 * }
 *
 * const EchoCommand = {
 *      command: 'echo',
 *      args: new CommandEchoArgs
 *      exec: async function(args: ..., ctx: UIContext) {
 *          ctx.reply(args.echo)
 *      }
 * }
 */
export type ICmdArgumentDefinition = CommandArgumentKeyHolder
/** @deprecated Use ICmdArgumentDefinition */
export type ICmdArgumentDefenition = ICmdArgumentDefinition

export function encodePositionalName(name: string, position: number) {
    if (!Number.isInteger(position) || position <= 0) {
        throw new Error("Position must be a number")
    }
    if (name.trim().length == 0) {
        throw new Error("Name must be a string")
    }
    return `positional-${position}-${name}`
}

export function decodePositionalName(input: string) {
    const constSkip = 'positional-'.length
    const position = parseInt(input.slice(constSkip).slice(0, input.indexOf('-')))
    const name = String(input.slice(input.indexOf('-', constSkip) + 1))

    return {
        position,
        name
    }
}

export * from './descriptor'
export * from './context'
export * from './option'
export * from './meta'
