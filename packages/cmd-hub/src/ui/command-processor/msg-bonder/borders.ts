// roundabout clockwise
type BorderSpread = [string, string, string, string]
type BorderSpreadType = 'empty' | 'simple' | 'double' | 'rounded'
const BorderSpreads: Record<BorderSpreadType, BorderSpread> = {
    empty: ['', '', '', ''],
    simple: ['┌', '┐', '└', '┘'],
    double: ['╔', '╗', '╚', '╝'],
    rounded: ['╭', '╮', '╰', '╯'],
}
