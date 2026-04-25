import { isObject } from './check'

/** Deep-merge `source` into `target`, recursing into nested plain objects.
 *  Tracks already-visited source nodes so cyclic input doesn't recurse forever
 *  — re-encounters share the (in-progress) target reference. */
export function deepMerge(target: any, source: any, visited = new Map<any, any>()): any {
    if (isObject(target) && isObject(source)) {
        for (const key in source) {
            if (isObject(source[key])) {
                if (!target[key]) {
                    target[key] = {}
                }
                if (!visited.has(source[key])) {
                    visited.set(source[key], target[key])
                    deepMerge(target[key], source[key], visited)
                } else {
                    target[key] = visited.get(source[key])
                }
            } else {
                target[key] = source[key]
            }
        }
    }
    return target
}
