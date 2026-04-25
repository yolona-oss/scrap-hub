/** Prefix attached to internal positional arg names so the dispatcher's
 *  argument list can carry multiple args with the same surface name across
 *  different positions / contexts without collision. Single source of
 *  truth — every reader (`isEncodedPositionalName`, `decodePositionalName`)
 *  derives off this. */
export const POSITIONAL_NAME_PREFIX = 'positional-'

export function encodePositionalName(name: string, position: number) {
    if (!Number.isInteger(position) || position <= 0) {
        throw new Error("Position must be a number")
    }
    if (name.trim().length == 0) {
        throw new Error("Name must be a string")
    }
    return `${POSITIONAL_NAME_PREFIX}${position}-${name}`
}

export function isEncodedPositionalName(input: string): boolean {
    return input.startsWith(POSITIONAL_NAME_PREFIX)
}

export function decodePositionalName(input: string) {
    const constSkip = POSITIONAL_NAME_PREFIX.length
    const position = parseInt(input.slice(constSkip).slice(0, input.indexOf('-')))
    const name = String(input.slice(input.indexOf('-', constSkip) + 1))

    return {
        position,
        name
    }
}
