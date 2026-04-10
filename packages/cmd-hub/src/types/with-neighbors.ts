export interface WithNeighbors {
    next: string[]
    prev: string
}

export function validateWithNeighborsMap(map: Map<string, Partial<WithNeighbors>>): boolean {
    for (const [key, value] of map.entries()) {
        if (value.prev !== undefined && !map.has(value.prev)) {
            console.error(`Invalid 'prev' value: ${value.prev} for key: ${key}`);
            return false;
        }

        if (value.next !== undefined) {
            for (const nextKey of value.next) {
                if (!map.has(nextKey)) {
                    console.error(`Invalid 'next' value: ${nextKey} for key: ${key}`);
                    return false;
                }
            }
        }
    }

    return true;
}
