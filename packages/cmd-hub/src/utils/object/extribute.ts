type Join<K, P> = K extends string | number
    ? P extends string | number
        ? `${K}${"" extends P ? "" : "."}${P}`
        : never
    : never

type Paths<T> = T extends object
    ? {
          [K in keyof T]: K extends string | number
              ? `${K}` | Join<K, Paths<T[K]>>
              : never
      }[keyof T]
    : never

type ExtractValue<T, Path extends string> =
    Path extends `${infer Key}.${infer Rest}`
        ? Key extends keyof T
            ? ExtractValue<T[Key], Rest> // Recursively extract the value
            : Key extends `${infer Index extends number}` // Check if Key is a numeric index
                ? T extends readonly any[] // Ensure T is an array
                    ? ExtractValue<T[Index], Rest> // Recursively extract the value from the array
                    : never // Invalid path (not an array)
                : never // Invalid path (key doesn't exist)
        : Path extends keyof T
            ? T[Path] // Base case: return the value at the final key
            : Path extends `${infer Index extends number}` // Check if Path is a numeric index
                ? T extends readonly any[] // Ensure T is an array
                    ? T[Index] // Return the value at the array index
                    : never // Invalid path (not an array)
                : never; // Invalid path (key doesn't exist)

type AddField<T, Path extends string, Value> = Path extends `${infer Key}.${infer Rest}`
    ? Key extends keyof T
        ? { [K in keyof T]: K extends Key ? AddField<T[K], Rest, Value> : T[K] }
        : { [K in keyof T]: T[K] } & { [key in Key]: AddField<{}, Rest, Value> }
    : { [K in keyof T]: T[K] } & { [key in Path]: Value }

type RemoveField<T, Path extends string> =
    Path extends `${infer Key}.${infer Rest}`
        ? Key extends keyof T
            ? { [K in keyof T]: K extends Key ? RemoveField<T[K], Rest> : T[K] } // Recursively remove the field
// @ts-ignore
            : Key extends `${infer Index extends number}` // Check if Key is a numeric index
                ? T extends readonly any[] // Ensure T is an array
                    ? { [K in keyof T]: K extends Key ? RemoveField<T[K], Rest> : T[K] } // Recursively remove the field from the array
                    : T // Invalid path (not an array)
                : T // Invalid path (key doesn't exist)
        : Path extends keyof T
            ? Omit<T, Path> // Base case: remove the field at the final key
// @ts-ignore
            : Path extends `${infer Index extends number}` // Check if Path is a numeric index
                ? T extends readonly any[] // Ensure T is an array
                    ? T // Arrays cannot have fields removed by index (use `splice` instead)
                    : T // Invalid path (not an array)
                : T; // Invalid path (key doesn't exist)

/**
 * Extracts a value from an object based on a path.
 * @param obj - The object to extract the value from.
 * @param path - The path to the value in the object. e.g. "a.b.c" return obj.a.b.c; arrays are supported by adding index after the key e.g. "a.8.b.c" returns obj.a[8].b.c
 * @returns The extracted value.
 */
export function extractValueFromObject<T, Path extends string>(
    obj: T,
    path: Path
): ExtractValue<T, Path> {
    const keys = path.split('.') as Array<keyof any>
    let current: any = obj

    for (const key of keys) {
        if (current && typeof current === 'object') {
            if (Array.isArray(current) && /^\d+$/.test(key as string)) {
                const index = parseInt(key as string, 10)
                if (index >= 0 && index < current.length) {
                    current = current[index]; // Traverse into the array
                } else {
                    throw new Error(`Invalid array index: ${index}`)
                }
            } else if (key in current) {
                current = current[key]; // Traverse into the object
            } else {
                throw new Error(`Invalid path: ${path}`)
            }
        } else {
            throw new Error(`Invalid path: ${path}`)
        }
    }

    return current as ExtractValue<T, Path>
}

/**
 * Assigns a value to a specific path in an object.
 * @param obj - The object to modify.
 * @param path - The path to assign the value to. e.g. "a.b.c" returns obj.a.b.c; array indexes are supported by adding index after array key.
 * @param value - The value to assign.
 * @returns The modified object.
 */
export function assignToCustomPath<T extends object, Path extends string, Value>(
    obj: T,
    path: Path,
    value: Value
): AddField<T, Path, Value> {
    const keys = path.split('.')
    let current: any = obj

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i]
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {}
        }
        current = current[key]
    }

    const finalKey = keys[keys.length - 1]
    current[finalKey] = value

    return obj as AddField<T, Path, Value>
}

export function removeFieldFromObject<T, Path extends string>(
    obj: T,
    path: Path
): RemoveField<T, Path> {
    const keys = path.split('.') as Array<keyof any>
    let current: any = obj

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i]
        if (current && typeof current === 'object') {
            if (Array.isArray(current) && /^\d+$/.test(key as string)) {
                const index = parseInt(key as string, 10)
                if (index >= 0 && index < current.length) {
                    current = current[index]
                } else {
                    throw new Error(`Invalid array index: ${index}`)
                }
            } else if (key in current) {
                current = current[key]
            } else {
                throw new Error(`Invalid path: ${path}`)
            }
        } else {
            throw new Error(`Invalid path: ${path}`)
        }
    }

    const finalKey = keys[keys.length - 1]
    if (current && typeof current === 'object' && finalKey in current) {
        if (Array.isArray(current)) {
            throw new Error(`Cannot remove array element by index: ${finalKey.toString()}`)
        } else {
            delete current[finalKey]
        }
    } else {
        throw new Error(`Invalid path: ${path}`)
    }

    return obj as RemoveField<T, Path>
}

//export function removeFieldFromObject(obj: any, path: string) {
//    const paths = path.split('.')
//
//    let current = obj
//    for (const key of paths) {
//        if (current[key] === undefined || current[key] === null) {
//            return
//        }
//
//        if (key === paths[paths.length - 1]) {
//            delete current[key]
//        } else {
//            current = current[key]
//        }
//    }
//    return obj
//}

//export function assignToCustomPath(obj: any, propPath: string, value: any) {
//    let paths = propPath.split(".")
//
//    if (propPath === '') {
//        obj = value
//        return obj
//    }
//
//    if (paths.length > 1) {
//        let key = <any>(paths.shift())
//        assignToCustomPath(
//            obj[key] =
//                Object.prototype.toString.call(obj[key]) === "[object Object]"
//                    ? obj[key]
//                    : {},
//            paths.join('.'),
//            value)
//    } else {
//        if (obj[paths[0]] === undefined || obj[paths[0]] === null) {
//            obj[paths[0]] = value
//        } else {
//            Object.assign(obj[paths[0]], value)
//        }
//    }
//
//    return obj
//}

//export function extractValueFromObject(data: any, field: string): any|null {
//    if (field === '') {
//        return data
//    }
//
//    if (typeof data === 'object') {
//        if (field in data) {
//            return data[field]
//        } else {
//            for (const value of Object.values(data)) {
//                const result = extractValueFromObject(value, field)
//                if (result !== null) {
//                    return result
//                }
//            }
//        }
//    } else if (Array.isArray(data)) {
//        for (const item of data) {
//            const result = extractValueFromObject(item, field)
//            if (result !== null) {
//                return result
//            }
//        }
//    }
//    return null
//}
