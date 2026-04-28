import { IBaseMarkup } from '../types/markup'
import { CBParser } from './interpreter/parser'
import { ICommandCompiled } from '../../../ui/types/command'
import { BuilderMarkuper } from './builder-markuper'

/**
 * One parser/interpreter step result: `done` flag, lazy `Markup`, and
 * the compiled command bundle when the build resolved. Markup is lazy
 * (rendered on first `await result.Markup`) so callers that only care
 * about the compile result don't pay for rendering.
 */
export class EvaluationResult {
    private done: boolean
    private compiled?: ICommandCompiled
    private error?: string
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

    get Markup(): Promise<IBaseMarkup> {
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
