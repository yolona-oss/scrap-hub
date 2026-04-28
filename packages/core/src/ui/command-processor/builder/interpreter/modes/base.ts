import { AbstractState, CmdArgumentProxy, chainHandlerFactory } from '@cmd-hub/common'
import { CBLexerToken, Lexer } from '../lexer'
import { UiUnicodeSymbols } from '../../../../../ui'
import { BuilderActionSigns } from '../../default-callbacks'
import { ICommandCompiled } from '../../../../../ui/types/command'
import { CBInterpreter } from '../interpreter'
import { CBParser, ParserPerformedAction, PChainReq } from '../parser'
import { EvaluationResult } from '../../ev-result'

type ExtendedCBChainRes =
    | ParserPerformedAction
    | 'cancel'
    | 'cancel-op'
    | 'execute'
    | 'ascend'

/**
 * Base interpreter component. Owns the lexer, registers the universal
 * action handlers (cancel-build, execute, cancel-op-with-ascent), and
 * maps every parser action to an `EvaluationResult`. Subclasses
 * (`InterpreterModeRequired`, `InterpreterModeNonMandatory`,
 * `InterpreterModeComprehensive`) override `step()` to add a
 * goal-reached compile check.
 */
export class BaseInterpreterComponent extends AbstractState<CBInterpreter> {
    private lexer: Lexer
    protected parser: CBParser<ExtendedCBChainRes>

    constructor(parser: CBParser) {
        super()
        this.parser = parser as unknown as CBParser<ExtendedCBChainRes>
        this.lexer = new Lexer()

        // cancel-build: hard exit. Markuper renders end state.
        this.parser.applyHandler(chainHandlerFactory<PChainReq, ExtendedCBChainRes>(function (this: BaseInterpreterComponent, req) {
            const { tkn } = req
            if (tkn.type === 'TEXT' && tkn.value && tkn.value === BuilderActionSigns.cancelBuild) {
                return 'cancel'
            }
            return
        }, this))

        // execute: only valid when not waiting for a leaf value and not
        // mid-branch (the user must back out before executing). The
        // interpreter resolves the parsed tree to a CmdArgumentProxy.
        this.parser.applyHandler(chainHandlerFactory<PChainReq, ExtendedCBChainRes>(function (this: BaseInterpreterComponent, req) {
            const { tkn } = req
            if (tkn.type === 'TEXT' && tkn.value === BuilderActionSigns.execute && this.parser.Pending == null) {
                return 'execute'
            }
            return
        }, this))

        // cancel-op: when inside a branch, ascend one level (acts as
        // "back" button). At root, fall through to a real cancel-op
        // (interpreter undoes the last token via parser.back()).
        this.parser.applyHandler(chainHandlerFactory<PChainReq, ExtendedCBChainRes>(function (this: BaseInterpreterComponent, req) {
            const { tkn } = req
            if (tkn.type === 'TEXT' && tkn.value === BuilderActionSigns.cancelOp) {
                if (this.parser.ascend()) return 'ascend'
                return 'cancel-op'
            }
            return
        }, this))
    }

    step(input: string): EvaluationResult {
        this.lexer.setInput(input)
        const tokens = this.lexer.tokenizeCurrent()

        if (tokens.length === 0) {
            return this.end()
        }

        let lastEv!: EvaluationResult
        for (const tkn of tokens) {
            const action = this.parser.parseNextToken(tkn)
            lastEv = this.processAction(action, tkn)
        }
        return lastEv
    }

    protected processAction(action: ExtendedCBChainRes, token: CBLexerToken): EvaluationResult {
        switch (action) {
            case 'none':
                return new EvaluationResult(this.parser, 'nothing to do', { done: false })

            case 'cancel':
                return new EvaluationResult(this.parser, 'Build canceled by user', { done: true, addTo: 'end' })

            case 'cancel-op':
                this.parser.back()
                return new EvaluationResult(
                    this.parser,
                    `${UiUnicodeSymbols.cross} Operation canceled by user`,
                    { done: false, addTo: 'end' },
                )

            case 'ascend':
                return new EvaluationResult(
                    this.parser,
                    `${UiUnicodeSymbols.arrowLeft} Back`,
                    { done: false, addTo: 'end' },
                )

            case 'pair-descend':
                // No-op evaluation; the markuper re-renders the new branch level.
                return new EvaluationResult(this.parser, '', { done: false })

            case 'await-value':
                return new EvaluationResult(this.parser, 'Awaiting value.', { done: false })

            case 'commit-leaf':
                return new EvaluationResult(this.parser, 'Argument set.')

            case 'toggle-on':
                return new EvaluationResult(this.parser, 'Standalone option toggled on.')

            case 'toggle-off':
                return new EvaluationResult(this.parser, 'Standalone option toggled off.')

            case 'execute': {
                const compiled = this.compile()
                return new EvaluationResult(
                    this.parser,
                    `${UiUnicodeSymbols.success} Build success`,
                    { compiled: compiled, addTo: 'end' },
                )
            }

            default:
                return new EvaluationResult(
                    this.parser,
                    `${UiUnicodeSymbols.error} - Unexpected action: "${action}" on token "${JSON.stringify(token)}"`,
                    { done: true, error: `Unexpected action: ${action}`, addTo: 'end' },
                )
        }
    }

    protected end(): EvaluationResult {
        return new EvaluationResult(this.parser, '', { done: true })
    }

    protected compile(): ICommandCompiled {
        const values = this.parser.Values
        return {
            command: this.parser.Command,
            proxy: new CmdArgumentProxy(values, this.parser.Tree),
            raw: new Map(values),
        }
    }
}
