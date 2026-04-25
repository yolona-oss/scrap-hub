/** Truncate `input` to `charsToKeep` characters, replacing the middle with `..`. */
export function shorten(input: string, charsToKeep: number): string {
    if (input.length <= charsToKeep) {
        return input
    }

    if (charsToKeep <= 3) {
        if (charsToKeep === 3) {
            return `${input[0]}..${input[input.length - 1]}`.slice(0, 3)
        } else {
            return input.slice(0, charsToKeep)
        }
    }

    const charsFromEachSide = Math.floor((charsToKeep - 2) / 2)
    const start = input.slice(0, charsFromEachSide)
    const remainingChars = charsToKeep - (charsFromEachSide * 2 + 2)
    const adjustedEnd = input.slice(-(charsFromEachSide + remainingChars))

    return `${start}..${adjustedEnd}`
}

/** Convert a hyphen-separated string to camelCase. */
export function camelCase(input: string): string {
    return input.toLowerCase().replace(/-(.)/g, function (_, group1) {
        return group1.toUpperCase()
    })
}

/** Coerce any thrown value into a printable string. Cycle-safe: falls back
 *  to `String(error)` when JSON.stringify trips on a circular reference. */
export function anyToString(error: unknown): string {
    if (error instanceof Error) return error.message
    if (error !== null && typeof error === 'object') {
        try {
            return JSON.stringify(error, null, 4)
        } catch {
            return String(error)
        }
    }
    return String(error)
}
