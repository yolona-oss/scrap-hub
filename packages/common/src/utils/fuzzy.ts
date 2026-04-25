import fuzzy from 'fuzzy'

type fuzzyMathMapOpts = {
    search: string,
    input: string,
    minScore: number,
    opts?: fuzzy.MatchOptions
}

export function fuzzyMatchMap(s: fuzzyMathMapOpts[]): boolean {
    let ret = false
    s.forEach(e => {
        const match = fuzzy.match(e.search, e.input, { caseSensitive: false },)
        if (match && match.score > e.minScore) {
            ret = true
        }
    })
    return ret
}

export function fuzzyMatchMapSimple(search: string[], input: string, minScore: number = 50) {
    return fuzzyMatchMap(search.map(e => {return { search: e, input: input, minScore: minScore }}))
}
