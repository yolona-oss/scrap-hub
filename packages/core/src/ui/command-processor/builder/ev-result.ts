import { BuilderMarkuper } from "./builder-markuper"
import { IBaseMarkup } from "../types/markup"
import { CBParser } from "./interpreter/parser"
import { ICommandCompiled } from "../../../ui/types/command"

export class EvaluationResult {
    private done: boolean
    /** Lazy: the markup is rendered asynchronously when the parser is in
     *  PAIR_VALUE on a hierarchical descriptor. Storing it as a promise
     *  lets EvaluationResult stay constructible from sync code. */
    private markup: Promise<IBaseMarkup>
    private compiled?: ICommandCompiled
    private error?: string

    constructor(
        parser: CBParser<any>,
        info: string|string[],
        config: {
            compiled?: ICommandCompiled
            done?: boolean
            error?: string
            addTo?: "begining"|"end"
        } = {}
    ) {
        this.done = config.compiled ? true : (config.done ?? false)
        this.compiled = config.compiled
        this.error = config.error
        this.markup = BuilderMarkuper.markup(parser, {
            text: {
                info: info,
                addTo: config.addTo
            },
        })
    }

    get Done() {
        return this.done
    }

    get Markup(): Promise<IBaseMarkup> {
        return this.markup
    }

    get HasError() {
        return Boolean(this.error)
    }

    get Error() {
        return this.error ?? "unknown error"
    }

    get IsCompiled() {
        return Boolean(this.compiled)
    }

    get Result() {
        if (this.IsCompiled) {
            return this.compiled!
        } else {
            throw new Error(`Assesing to built result but there are not done`)
        }
    }
}
