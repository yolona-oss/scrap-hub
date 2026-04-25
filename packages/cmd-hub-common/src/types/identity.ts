/** Sentinel brands for ID-validation results. */
export const VALID_ID_BRAND = "__valid_id__"
export const INVALID_ID_BRAND = "__invalid_id__"

/** Objects that carry a user-meaningful identifier. */
export interface Identificable<T extends string | number = string> {
    id: T
}

function validateId(id: string): boolean {
    return /^[a-z0-9_-]+$/.test(id)
}

function transformToValidId(id: string): string {
    if (validateId(id)) {
        return id
    }

    const copy = id
    copy.replace(/[^a-z0-9_-]+/gi, '').toLowerCase()
    if (copy.length === 0) {
        throw new Error(`Cannot transform ${id} to a valid ID`)
    }

    return copy
}

/** Validate `id` matches `/^[a-z0-9_-]+$/` and return it; throws otherwise. */
export function asId(id: string): string {
    return transformToValidId(id)
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
