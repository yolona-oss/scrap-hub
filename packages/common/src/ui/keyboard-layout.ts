import type { IMarkupButton, IMarkupOption, IBaseMarkup } from './markup'

/**
 * Group `btns` by `type`, paginate at `perLine`, and map each option through
 * `mk` to a UI-specific button primitive. Empty groups are skipped.
 *
 * The renderer (Telegram inline keyboard, Web button row, etc.) supplies its
 * own button factory; the layout itself is UI-agnostic.
 */
export function layoutCommonKeyboard<Btn>(
    btns: ReadonlyArray<IMarkupOption>,
    perLine: number,
    mk: (m: IMarkupOption) => Btn,
): Btn[][] {
    const out: Btn[][] = []
    const groups = new Map<string, IMarkupOption[]>()
    for (const btn of btns) {
        const g = groups.get(btn.type) ?? []
        g.push(btn)
        groups.set(btn.type, g)
    }
    for (const [, group] of groups) {
        for (let i = 0; i < group.length; i += perLine) {
            out.push(group.slice(i, i + perLine).map(mk))
        }
    }
    return out
}

/**
 * Render a builder markup. Non-aux buttons are paginated at `perLine`; the
 * `aux` row (gear/control buttons) is appended last as a single row. The
 * `kind` argument tells `mk` whether the option is a regular builder choice
 * or an aux — useful when the caller wants to prefix the data string.
 */
export function layoutBuilderKeyboard<Btn>(
    markup: IBaseMarkup,
    perLine: number,
    mk: (m: IMarkupButton, kind: 'builder' | 'aux') => Btn,
): Btn[][] {
    const buttons = markup.buttons ?? []
    if (buttons.length === 0) return [[]]
    const out: Btn[][] = []
    const main = buttons.filter(b => b.type !== 'aux')
    const aux = buttons.filter(b => b.type === 'aux')
    for (let i = 0; i < main.length; i += perLine) {
        out.push(main.slice(i, i + perLine).map(b => mk(b, 'builder')))
    }
    out.push(aux.map(b => mk(b, 'aux')))
    return out
}
