import { UiUnicodeSymbols } from '../../../ui'
import { walkLeaves, nodeAtPath, PAIR_PATH_DELIMITER, type LeafSpec } from '@cmd-hub/common'
import { CBParser } from './interpreter/parser'
import { BuilderMarkups } from './default-markup'
import { BuilderActionSigns } from './default-callbacks'
import { IMarkupButton, IBaseMarkup } from '../types/markup'
import type { SavedSources } from '../saved-sources'

interface IBuilderMarkupOpts {
    text?: {
        overwrite?: string
        info: string | string[]
        addTo?: 'begining' | 'end'
    }
    options?: {
        extra_buttons?: IMarkupButton[]
    }
}

/**
 * Render a `CBParser`'s state to text + button rows.
 *
 * The markuper observes three parser conditions and renders accordingly:
 *
 *   1. **Pending leaf (await-value)** — the user clicked a leaf. Render
 *      its `options[]` as value buttons, or fall back to a free-form
 *      prompt when `options` is empty.
 *
 *   2. **Mid-branch, no pending** — the parser is sitting at a branch
 *      below the root. Render the branch's children: branches get
 *      a `→` arrow suffix; leaves get a `--` prefix the parser will
 *      decode as DOUBLE_DASH on click. The aux row gains a Back
 *      button that maps to the cancel-op sign (which the interpreter
 *      treats as ascend).
 *
 *   3. **At root, no pending** — same as (2) at the tree root, with
 *      the default aux row (execute / cancel-build).
 */
export class BuilderMarkuper {
    private constructor() {}

    /** Entry-point markup shown when a build first starts. Lists every
     *  declared leaf (across every branch level) with its required-flag,
     *  description, and any saved-config preview. */
    static async intro(
        parser: CBParser,
        savedSources?: SavedSources,
    ): Promise<IBaseMarkup> {
        const overwrite = BuilderMarkuper._renderIntroText(parser, savedSources)
        return BuilderMarkuper.markup(parser, { text: { overwrite, info: '' } })
    }

    static async markup(parser: CBParser, opts: IBuilderMarkupOpts): Promise<IBaseMarkup> {
        const text = opts.text ?? { info: '' }
        const options = opts.options ?? {}
        const infoText = Array.isArray(text.info) ? text.info.join('\n') : text.info

        const stateButtons = BuilderMarkuper._renderStateButtons(parser)
        const auxButtons = BuilderMarkuper._renderAuxButtons(parser)

        const mk_text = text.overwrite ?? BuilderMarkuper._renderBuildingText(parser, infoText, text.addTo)
        const buttons = [...stateButtons, ...auxButtons, ...(options.extra_buttons ?? [])]
        return { text: mk_text, buttons }
    }

    /* -- button rendering ------------------------------------------- */

    private static _renderStateButtons(parser: CBParser): IMarkupButton[] {
        const pending = parser.Pending
        if (pending) {
            const node = nodeAtPath(parser.Tree, pending.leafPath)
            if (!node || node.node !== 'leaf') return []
            return BuilderMarkuper._leafOptionButtons(node)
        }
        const node = parser.nodeAtCurrent()
        if (!node) return []
        // Single-leaf root: rare "one-argument command" shape. Render its
        // options as if the user had already clicked it.
        if (node.node === 'leaf') return BuilderMarkuper._leafOptionButtons(node)
        const out: IMarkupButton[] = []
        for (const [name, child] of node.children) {
            out.push(BuilderMarkuper._childButton(name, child, parser))
        }
        return out
    }

    private static _leafOptionButtons(leaf: LeafSpec): IMarkupButton[] {
        return leaf.options.map(opt => ({
            text: opt,
            type: 'value' as const,
            data: opt,
            isRead: false,
        }))
    }

    private static _childButton(
        name: string,
        child: ReturnType<typeof CBParser.prototype.nodeAtCurrent> & object,
        parser: CBParser,
    ): IMarkupButton {
        const isBranch = child.node === 'branch'
        const isStandalone = child.node === 'leaf' && child.standalone
        const fullPath = [...parser.Path, name].join(PAIR_PATH_DELIMITER)
        const isSet = parser.Values.has(fullPath)
        const arrow = isBranch ? ` ${UiUnicodeSymbols.arrowRight}` : ''
        const check = isSet ? ` ${UiUnicodeSymbols.check}` : ''
        return {
            text: `${name}${arrow}${check}`,
            type: 'name' as const,
            data: `${isStandalone ? '-' : '--'}${name}`,
            isRead: isSet,
        }
    }

    private static _renderAuxButtons(parser: CBParser): IMarkupButton[] {
        // Mid-branch (or pending mid-branch): aux row is a single Back
        // button that drives the interpreter's cancel-op→ascend reaction.
        if (parser.Path.length > 0) {
            return [{
                text: `${UiUnicodeSymbols.arrowLeft} Back`,
                type: 'aux',
                data: BuilderActionSigns.cancelOp,
                isRead: false,
            }]
        }
        return BuilderMarkups.default
    }

    /* -- text rendering --------------------------------------------- */

    private static _renderBuildingText(
        parser: CBParser,
        info: string,
        addTo: 'begining' | 'end' = 'end',
    ): string {
        const command = parser.Command
        const infoLine = info.length > 1 ? `${UiUnicodeSymbols.info} - ${info}` : ''

        let text = `${UiUnicodeSymbols.hammer} Building "${command}"`
        if (parser.Path.length > 0) {
            text += `\n* path: ${parser.Path.join(PAIR_PATH_DELIMITER)}`
        }
        if (parser.Pending) {
            text += `\n* awaiting value for: ${parser.Pending.leafPath.join(PAIR_PATH_DELIMITER)}`
        }

        const lines: string[] = []
        for (const [key, value] of parser.Values) {
            lines.push(` - ${UiUnicodeSymbols.gear} ${key}: ${value} ${UiUnicodeSymbols.check}`)
        }
        if (lines.length > 0) text += `\n* committed:\n${lines.join('\n')}`

        text += BuilderMarkuper._renderSavedDefaults(parser)

        if (addTo === 'begining') return `${infoLine}\n\n${text}`
        return `${text}\n\n${infoLine}`
    }

    private static _renderSavedDefaults(parser: CBParser): string {
        const saved = parser.SavedSources
        if (!saved || saved.size === 0) return ''
        const setKeys = new Set(parser.Values.keys())
        const lines: string[] = []
        for (const [key, entry] of saved) {
            if (setKeys.has(key)) continue
            const display = entry.value.slice(0, 35)
            lines.push(` - ${UiUnicodeSymbols.info} ${key}: ${display} (${entry.source})`)
        }
        if (lines.length === 0) return ''
        return `\n\n${UiUnicodeSymbols.lock} Saved defaults:\n${lines.join('\n')}`
    }

    private static _renderIntroText(parser: CBParser, savedSources?: SavedSources): string {
        const command = parser.Command
        let text = `${UiUnicodeSymbols.hammer} Run CmdBuilder\n` +
            `Building command: ${UiUnicodeSymbols.arrowRight} "${command}"\n`

        for (const { pathKey, leaf } of walkLeaves(parser.Tree)) {
            const brackets = leaf.required ? '<>' : '[]'
            const desc = leaf.description || 'No description'
            text += ` - ${brackets[0]}${pathKey}${brackets[1]} - ${desc}\n`
        }

        if (savedSources && savedSources.size > 0) {
            text += `\n${UiUnicodeSymbols.info} Saved config will be applied:\n`
            for (const [key, entry] of savedSources) {
                const display = entry.value.slice(0, 40)
                text += `  ${key}: ${display} (${entry.source})\n`
            }
        }
        return text
    }
}
