import { isObjectsEqual } from "./object"

export function intersect<T>(a: T[], b: T[]): T[] {
    return a.filter(x => b.includes(x))
}

export function difference<T>(a: T[], b: T[]): T[] {
    return a.filter(x => !b.includes(x))
}

export function union<T>(a: T[], b: T[]): T[] {
    return [...a, ...b]
}

export function unique<T>(a: T[]): T[] {
    return [...new Set(a)]
}

export function isUnique<T>(a: T[]): boolean {
    return a.length === unique(a).length
}

export function isEqual_JsonSort<T>(a: T[], b: T[]): boolean {
    return JSON.stringify(a.sort()) === JSON.stringify(b.sort())
}

export function isEqual_Simple<T>(arr1: T[], arr2: T[]): boolean {
    return arr1.length === arr2.length &&
        arr1.every((value, index) => value === arr2[index])
}

export function isEqual_Deep<T>(arr1: T[], arr2: T[]): boolean {
    if (arr1.length !== arr2.length) return false

    for (let i = 0; i < arr1.length; i++) {
        if (typeof arr1[i] === 'object' && typeof arr2[i] === 'object') {
            if (!isObjectsEqual(arr1[i], arr2[i])) return false
        } else if (arr1[i] !== arr2[i]) {
            return false
        }
    }

    return true
}

//const map2 = new Map(this.array2.map(x => [x.type, s]))
//const intersect = this.array1.filter(a1 => 
//  map.has(a1.type))

export function isContainsAll<T>(base: T[], overlap: T[]): boolean {
    //return isEqual(base.filter(b => overlap.some(o => b === o)), overlap)
    return overlap.every(val => base.includes(val))
}

//export function isArrayFullyOverlapping<T>(base: T[], overlap: T[]): boolean {
//    if (base.length === 0) return true
//    if (overlap.length === 0) return base.length === 0
//    return base.every((item) => overlap.includes(item))
//}
//
//export function isArrayPartiallyOverlapping<T>(base: T[], overlap: T[]): boolean {
//    if (base.length === 0) return true
//    if (overlap.length === 0) return base.length === 0
//    const overlapSet = new Set(overlap)
//    return base.every((item) => overlapSet.has(item))
//}

export function shuffle<T>(array: T[]) { 
    for (let i = array.length - 1; i > 0; i--) { 
        const j = Math.floor(Math.random() * (i + 1)); 
        [array[i], array[j]] = [array[j], array[i]]; 
    }
    return array; 
}; 

export function removeObjectByFieldsMutate<T>(
    arr: T[],
    criteria: Partial<T>
): void {
    for (let i = arr.length - 1; i >= 0; i--) {
        let match = true
        for (const key in criteria) {
            if (criteria.hasOwnProperty(key) && arr[i][key] !== criteria[key]) {
                match = false
                break
            }
        }
        if (match) {
            arr.splice(i, 1); // Remove the object at index `i`
        }
    }
}
