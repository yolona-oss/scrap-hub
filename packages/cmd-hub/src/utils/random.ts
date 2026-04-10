import { LowerCaseLatinLatter, NumberLatter, UpperCaseLatinLatter } from "@core/constants/alphabets"
import crypto from "crypto"

export const isNumberPositive = (v: number) => v > 0

const toRandomStringGenAlphabet = [...UpperCaseLatinLatter, ...LowerCaseLatinLatter, ...NumberLatter].join('')
export const genRandomString = (length: number = 15) => {
    const charactersLength = toRandomStringGenAlphabet.length
    const randomValues = new Uint32Array(length)
    crypto.getRandomValues(randomValues)

    let result = ''
    for (let i = 0; i < length; i++) {
        result += toRandomStringGenAlphabet.charAt(randomValues[i] % charactersLength)
    }

    return result
}
export const genRandomNumber = (length: number = 15) => genRandomNumberBetween(10 ** (length - 1), 10 ** length)

export function genRandomNumberBetween<T extends number | bigint>(min: T, max: T): T {
    if (typeof min === "bigint" && typeof max === "bigint") {
        const range = max - min + BigInt(1)
        const randomBigInt = crypto.getRandomValues(new BigUint64Array(1))[0] % range
        return min + randomBigInt as T
    } else if (typeof min === "number" && typeof max === "number") {
        const array = new Uint32Array(1)
        const randomInt = crypto.getRandomValues(array)
        return randomInt[0] % (max - min + 1) + min as T
    } else {
        throw new Error("Invalid types for min and max. They must both be either number or bigint.")
    }
}

export function genRandomNumberBetweenWithScatter<T extends number|bigint = number>(
    min: T,
    max: T,
    scatter: T,
    fixed = 2
): T {
    if (typeof min !== typeof max || typeof min !== typeof scatter) {
        throw new Error("min, max, and scatter must be of the same type (Number or BigInt)")
    }

    if (typeof min === 'number') {
        // Handle Number type
        const scatterMin = min - (scatter as number)
        // @ts-ignore
        const scatterMax = max + (scatter as number)

        // Ensure scatterMin and scatterMax are within valid bounds
        const adjustedMin = Math.max(scatterMin, Number.MIN_SAFE_INTEGER)
        const adjustedMax = Math.min(scatterMax, Number.MAX_SAFE_INTEGER)

        // Generate a random number between the adjusted min and max
        return Number((Math.floor(Math.random() * (adjustedMax - adjustedMin + 1)) + adjustedMin).toFixed(fixed)) as T
    } else if (typeof min === 'bigint') {
        // Handle BigInt type
        const scatterMin = min - (scatter as bigint)
        // @ts-ignore
        const scatterMax = max + (scatter as bigint)

        // Ensure scatterMin and scatterMax are within valid bounds
        const adjustedMin = scatterMin < 0n ? 0n : scatterMin; // Example lower bound for BigInt
        const adjustedMax = scatterMax > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : scatterMax

        // Generate a random BigInt between the adjusted min and max
        const range = adjustedMax - adjustedMin + 1n
        const randomBits = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER))
        return adjustedMin + (randomBits % range) as T
    } else {
        throw new Error("Unsupported type for min, max, or scatter")
    }
}

export function randomizeWithScatter<T extends number|bigint = number>(value: T, scatter: T, fixed = 2) {
    return genRandomNumberBetweenWithScatter<T>(value, value, scatter, fixed)
}

export function randomizeWithPercentScatter<T extends number|bigint = number>(value: T, percent: number, fixed = 2) {
    let scatter: bigint|number
    if (typeof value === "bigint") {
        scatter = value * (BigInt(percent) / BigInt(100))
    } else if (typeof value === "number") {
        scatter = value * (percent / 100)
    } else {
        throw new Error("Unsupported type for value")
    }
    return genRandomNumberBetweenWithScatter<T>(value, value, scatter as T, fixed)
}
