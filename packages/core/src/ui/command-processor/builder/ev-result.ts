import { IBaseMarkup } from '../types/markup'
import { CBParser } from './interpreter/parser'
import { ICommandCompiled } from '../../../ui/types/command'

/**
 * Result of one parser/interpreter step. Carries:
 *
 *  - whether the build is `done` (cancelled, errored, or compiled)
 *  - the lazy `Markup` (rendered by the builder-markuper on demand)
 *  - a compiled command bundle if the build resolved
 *
 * The markup is lazy on purpose: rendering pulls the builder-markuper,
 * which depends on the active descriptor's tree shape. Constructing an
 * `EvaluationResult` should be cheap enough that the parser/interpreter
 * unit tests don't drag the markuper into their import graph — callers
 * who need the rendered markup `await result.Markup`, which loads the
 * markuper module on first read.
 */
export class EvaluationResult {
    private done: boolean
    private compiled?: ICommandCompiled
    private error?: string
    // Parser is generic over its action type (each interpreter mode
    // extends the action vocabulary), so accept `any` here.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private parser: CBParser<any>
    private info: string | string[]
    private addTo?: 'begining' | 'end'

    constructor(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        parser: CBParser<any>,
        info: string | string[],
        config: {
            compiled?: ICommandCompiled
            done?: boolean
            error?: string
            addTo?: 'begining' | 'end'
        } = {},
    ) {
        this.parser = parser
        this.info = info
        this.addTo = config.addTo
        this.done = config.compiled ? true : (config.done ?? false)
        this.compiled = config.compiled
        this.error = config.error
    }

    get Done(): boolean {
        return this.done
    }

    /** Lazy-resolve the markup so callers without a markuper available
     *  (parser unit tests, headless callers) don't pay for it. The
     *  `require` is deliberately lazy to keep the import graph optional. */
    get Markup(): Promise<IBaseMarkup> {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { BuilderMarkuper } = require('./builder-markuper') as typeof import('./builder-markuper')
        return BuilderMarkuper.markup(this.parser, {
            text: { info: this.info, addTo: this.addTo },
        })
    }

    get HasError(): boolean {
        return Boolean(this.error)
    }

    get Error(): string {
        return this.error ?? 'unknown error'
    }

    get IsCompiled(): boolean {
        return Boolean(this.compiled)
    }

    get Result(): ICommandCompiled {
        if (!this.compiled) {
            throw new Error('Accessing built result, but the build is not done.')
        }
        return this.compiled
    }
}
