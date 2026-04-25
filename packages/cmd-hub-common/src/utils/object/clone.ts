/**
 * @description Deep clone an object. Preserve functions, arrays, and objects recursively.
 * @param obj - The object to clone. May be null or undefined.
 * @returns The cloned object or the original object if null or undefined.
 */
export function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj
    }

    if (typeof obj === 'function') {
        // @ts-ignore
        return obj.bind({}); // Clone the function
    }

    if (Array.isArray(obj)) {
        const arrCopy = [] as any[]
        for (const item of obj) {
            arrCopy.push(deepClone(item))
        }
        return arrCopy as unknown as T
    }

    const objCopy = {} as { [key: string]: any }
    for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
            objCopy[key] = deepClone(obj[key])
        }
    }
    return objCopy as T
}
