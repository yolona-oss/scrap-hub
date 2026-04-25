export namespace Humanizer {
    namespace Postfixes {
        export const num_long = [
            "thousand",
            "million",
            "billion",
            "trillion",
            "quadrillion",
            "quintillion",
            "sextillion",
            "septillion",
            "octillion",
            "nonillion",
            "decillion",
        ]

        export const ext_short = [
            "k",
            "M",
            "G",
            "T",
            "P",
            "E",
            "Z",
            "Y",
            "Q",
            "R",
            "S",
            "O",
        ]

        export const ext_long = [
            "Kilo",
            "Mega",
            "Giga",
            "Tera",
            "Peta",
            "Exa",
            "Zetta",
            "Yotta",
            "Quetta",
            "Ronna",
            "Sexta",
            "Octa",
        ]

        export const binary_1000_short = [
            "Kib",
            "Mib",
            "Gib",
            "Tib",
            "Pib",
            "Eib",
            "Zib",
            "Yib",
            "Qib",
            "Rib",
            "Sib",
            "Oib",
        ]

        export const binary_1024_short = [
            "KB",
            "MB",
            "Gb",
            "TB",
            "PB",
            "EB",
            "ZB",
            "YB",
            "QB",
            "RB",
            "SB",
            "OB",
        ]

        export const binary_1024_long = [
            "KiloBytes",
            "MegaBytes",
            "GigaBytes",
            "TeraBytes",
            "PetaBytes",
            "ExaBytes",
            "ZettaBytes",
            "YottaBytes",
            "QuettaBytes",
            "RonnaBytes",
            "SextaBytes",
            "OctaBytes",
        ]
    }

    const extLong = true
    const fixed = 3

    type toHuman = (num: bigint) => string

    export function number(num: bigint): string {
        const digitsToPostfix = (dig: number): string => {
            const ind = Math.floor(dig / 3)-1
            if (ind < 0) {
                return ""
            }
            const SelPostfix = extLong ? Postfixes.ext_long : Postfixes.ext_short
            if (ind < SelPostfix.length)
                return SelPostfix[ind]
            console.log("err: too many digits")
            return ""
        }
        const digits = num.toString().length

        const postfix = digitsToPostfix(digits)

        const power = Math.ceil(digits / 3) * 3
        return `${(Number(num) / (10 ** power)).toFixed(fixed)}${postfix}`
    }
}
