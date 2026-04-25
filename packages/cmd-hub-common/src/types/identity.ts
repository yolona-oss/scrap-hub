/** Objects that carry a user-meaningful identifier. */
export interface Identificable<T extends string | number = string> {
    id: T
}

function validateId(id: string): boolean {
    return /^[a-z0-9_-]+$/.test(id)
}

/** Coerce `id` to the `/^[a-z0-9_-]+$/` shape: strip disallowed chars, lower-case
 *  the result. Throws when nothing valid remains. */
export function asId(id: string): string {
    if (validateId(id)) return id
    const cleaned = id.replace(/[^a-z0-9_-]+/gi, '').toLowerCase()
    if (cleaned.length === 0) {
        throw new Error(`Cannot transform "${id}" to a valid ID`)
    }
    return cleaned
}

export function genRandId(): string {
    return crypto.randomUUID()
}

/** Type guard for `Identificable<T>`. Strings are validated against the
 *  `/^[a-z0-9_-]+$/` rule; numbers are accepted as-is. */
export function isIdentifiable<T extends string | number = string>(
    obj: unknown,
): obj is Identificable<T> {
    if (typeof obj !== 'object' || obj === null || !('id' in obj)) {
        return false
    }
    const id = (obj as { id: unknown }).id
    if (typeof id === 'string') return validateId(id)
    if (typeof id === 'number') return true
    return false
}
