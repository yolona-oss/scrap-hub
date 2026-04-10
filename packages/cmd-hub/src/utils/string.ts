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
    const end = input.slice(-charsFromEachSide)

    const remainingChars = charsToKeep - (charsFromEachSide * 2 + 2)
    const adjustedEnd = input.slice(-(charsFromEachSide + remainingChars))

    return `${start}..${adjustedEnd}`
}
