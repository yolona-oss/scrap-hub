import { VALID_ID_BRAND } from "@core/constants/brands"

/**
 * Interface for objects that have an `id` property.
 * @template T - The type of the `id` property.
 * @property {T} id - The ID of the object.
 */
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

/**
 * Creates a valid ID from a string.
 * @param id - The ID to create that will be checked with regex /^[a-z0-9_-]+$/.
 * @returns The created ID or throws an error.
 */
export function asId(id: string): string {
    return transformToValidId(id)
}

let idCounter = 0
function genIncremId(): string {
    return `incremental_id_${idCounter++}`
}

export function genRandId(): string {
    return crypto.randomUUID()
}

/**
 * Type guard to check if an object is `Identifiable` and its `id` is valid according to `isId`.
 * @param obj - The object to check.
 * @returns `true` if the object is `Identifiable` and its `id` is valid, otherwise `false`.
 */
export function isIdentifiable<T extends string | number = string>(
    obj: any
): obj is Identificable<T> {
    if (typeof obj !== 'object' || obj === null || !('id' in obj)) {
        return false
    }

    if (typeof obj.id === 'string') {
        return validateId(obj.id)
    }

    if (typeof obj.id === 'number') {
        return true
    }

    return false
}
