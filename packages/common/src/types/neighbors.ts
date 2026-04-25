/** Forward/backward neighbour link for graph-shaped command sequences. */
export interface WithNeighbors {
    next: string[]
    prev: string
}

/** Validates that every `next`/`prev` reference points at a key in `map`.
 *  Returns false (and logs the offender) on any dangling reference. */
export function validateWithNeighborsMap(map: Map<string, Partial<WithNeighbors>>): boolean {
    for (const [key, value] of map.entries()) {
        if (value.prev !== undefined && !map.has(value.prev)) {
            console.error(`Invalid 'prev' value: ${value.prev} for key: ${key}`)
            return false
        }

        if (value.next !== undefined) {
            for (const nextKey of value.next) {
                if (!map.has(nextKey)) {
                    console.error(`Invalid 'next' value: ${nextKey} for key: ${key}`)
                    return false
                }
            }
        }
    }

    return true
}
