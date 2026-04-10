import assert from 'assert'

import { AlphabetOrderType } from "@core/constants/alphabets"
import { LowerCaseLatinLatter, UpperCaseLatinLatter, NumberLatter, SpecialCharacter } from "@core/constants/alphabets"

const alphabets = [
    {
        type: AlphabetOrderType.LoverCase,
        length: 26,
        alphabet: LowerCaseLatinLatter
    },
    {
        type: AlphabetOrderType.UpperCase,
        length: 26,
        alphabet: UpperCaseLatinLatter
    },
    {
        type: AlphabetOrderType.Number,
        length: 10,
        alphabet: NumberLatter,
    },
    {
        type: AlphabetOrderType.SpecialCharacter,
        length: 31,
        alphabet: SpecialCharacter
    }
]

assert(alphabets.find(a => a.type === AlphabetOrderType.LoverCase)!.alphabet.length === alphabets.find(a => a.type === AlphabetOrderType.LoverCase)!.length)
assert(alphabets.find(a => a.type === AlphabetOrderType.UpperCase)!.alphabet.length === alphabets.find(a => a.type === AlphabetOrderType.UpperCase)!.length)
assert(alphabets.find(a => a.type === AlphabetOrderType.Number)!.alphabet.length === alphabets.find(a => a.type === AlphabetOrderType.Number)!.length)
assert(alphabets.find(a => a.type === AlphabetOrderType.SpecialCharacter)!.alphabet.length === alphabets.find(a => a.type === AlphabetOrderType.SpecialCharacter)!.length)

export const calculateEntropy = (str: string) => {
    let L = 0
    const strArr = Array.from(str)
    const usedAlpas = new Set<AlphabetOrderType>()
    for (const set of alphabets) {
        if (strArr.some(c => set.alphabet.includes(c))) {
            L += set.length
            usedAlpas.add(set.type)
        }
    }
    return {
        entropy: Math.log2(Math.pow(L, str.length)),
        alphabetLength: L,
        alphabetsUsed: usedAlpas
    }
}
