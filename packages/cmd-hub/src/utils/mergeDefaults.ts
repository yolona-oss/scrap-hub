export function mergeDefaults<T>(obj: Partial<T>, defaults: T): T {
    return { ...defaults, ...obj }
}
