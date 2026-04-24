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
