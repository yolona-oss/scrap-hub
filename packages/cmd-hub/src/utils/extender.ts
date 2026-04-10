export namespace Extender {

    type TimePrefix = 'ns' | 'ms' | 's' | 'm' | 'h' | 'd' | 'y' | 'M'

    type NumberStringPrefix<T extends string> = 
      T extends `${infer NumberPart}${infer Prefix}` 
        ? Prefix extends TimePrefix
          ? NumberPart extends `${number}`
            ? T
            : never
          : never
        : never

    /**
     * NOTE: Not handle lean years and every month have 365/12 days
     */
    export function stringToMs<T extends string>(time: NumberStringPrefix<T>): number {
        const numMatch = (time as string).match(/\d+/)
        if (!numMatch) {
            throw new Error('Invalid time format number')
        }
        const prefixMatch = (time as string).match(/[a-zA-Z]+/)
        if (!prefixMatch) {
            throw new Error('Invalid time format prefix')
        }
        const num = parseInt(numMatch[0])
        const postfix = prefixMatch[0]
        switch (postfix) {
            case 'ns':
                return num / 1000000
            case 'ms':
                return num
            case 's':
                return num * 1000
            case 'm':
                return num * 1000 * 60
            case 'h':
                return num * 1000 * 60 * 60
            case 'd':
                return num * 1000 * 60 * 60 * 24
            case 'y':
                return num * 1000 * 60 * 60 * 24 * 365
            case 'M':
                return num * 1000 * 60 * 60 * 24 * 365 / 12
            default:
                throw new Error('Invalid time format prefix')
        }
    }
}
