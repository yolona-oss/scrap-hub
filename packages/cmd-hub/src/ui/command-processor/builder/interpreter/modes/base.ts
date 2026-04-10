import { CBLexerToken, Lexer } from "./../lexer";
import { UiUnicodeSymbols } from "@core/ui";
import { BuilderActionSigns } from "./../../default-callbacks";
import { ICommandCompiled } from '@core/ui/types/command';
import { AbstractState } from "@core/types/state";
import { CBInterpreter } from "../interpreter";
import { CBParser, ParserPerformedAction, PChainReq } from "../parser";
import { EvaluationResult } from "../../ev-result";
import log from "@core/application/logger";
import { chainHandlerFactory } from "@core/utils/chain";
import { CmdArgumentProxy } from "@core/ui/command-processor/arg-proxy";

type ExtendedCBChainRes = ParserPerformedAction | 'cancel' | 'cancel-op' | 'execute'

/**
 * Base component that contain main interpritation logic for command builder
 * @description Implements base incremental reading. Stop will be triggered by default invokables "execute"
 *
 * @extends AbstractState to manage state
 */
export class BaseInterpreterComponent extends AbstractState<CBInterpreter> {
    private lexer: Lexer
    protected parser: CBParser<ExtendedCBChainRes>

    constructor(parser: CBParser) {
        super()
        this.parser = parser
        this.lexer = new Lexer()

        this.parser.applyHandler(chainHandlerFactory<PChainReq, ExtendedCBChainRes>(function(this: BaseInterpreterComponent, req) {
            const { tkn } = req
            if (tkn.type == 'TEXT' && tkn.value && tkn.value === BuilderActionSigns.cancelBuild) {
                return 'cancel'
            }
            return
        }, this))

        this.parser.applyHandler(chainHandlerFactory<PChainReq, ExtendedCBChainRes>(function(this: BaseInterpreterComponent, req) {
            const { tkn } = req
            if (tkn.type == 'TEXT' && this.parser.State === 'IDLE' && tkn.value && tkn.value === BuilderActionSigns.execute) {
                return 'execute'
            }
            return
        }, this))

        this.parser.applyHandler(chainHandlerFactory<PChainReq, ExtendedCBChainRes>(function(this: BaseInterpreterComponent, req) {
            const { tkn } = req
            if (tkn.type == 'TEXT' && tkn.value && tkn.value === BuilderActionSigns.cancelOp) {
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
                return new EvaluationResult(
                    this.parser,
                    'nothing to do',
                    { done: false }
                )

            case 'cancel': 
                return new EvaluationResult(
                    this.parser,
                    `Build canceled by user`,
                    { done: true, addTo: 'end' }
                )

            case 'cancel-op':
                this.parser.back()
                return new EvaluationResult(
                    this.parser,
                    `${UiUnicodeSymbols.cross} Operation canceled by user`,
                    { done: false, addTo: 'end' }
                )

            case 'execute':
                const compiled = this.compile()
                return new EvaluationResult(
                    this.parser,
                    `${UiUnicodeSymbols.success} Build success`
                    , { compiled: compiled, addTo: 'end' }
                )

            case 'set-pair':
                return new EvaluationResult(
                    this.parser,
                    `Pair name and value was set.`,
                )

            case 'set-pair-name':
                return new EvaluationResult(
                    this.parser,
                    `Pair name was set.`
                )

            case 'set-pair-value':
                return new EvaluationResult(
                    this.parser,
                    `Pair value was set.`
                )

            case 'set-standalone':
                return new EvaluationResult(
                    this.parser,
                    `Standalone option was set.`
                )

            case 'unset-standalone':
                return new EvaluationResult(
                    this.parser,
                    `Standalone option was unset.`
                )

            case 'set-positional':
                return new EvaluationResult(
                    this.parser,
                    `Positional argument was set.`,
                )

            case 'ctx-switch':
                return new EvaluationResult(
                    this.parser,
                    `Reading context switched to new.`,
                )

            case 'ctx-selection':
                return new EvaluationResult(
                    this.parser,
                    `Context selection started.`,
                )

            case 'removed-pair':
                return new EvaluationResult(
                    this.parser,
                    `Pair was removed.`,
                )

            case 'removed-standalone':
                return new EvaluationResult(
                    this.parser,
                    `Standalone was removed.`,
                )

            case 'removed-positional':
                return new EvaluationResult(
                    this.parser,
                    `Positional was removed.`,
                )

            case 'value-validation-failed':
                return new EvaluationResult(
                    this.parser,
                    `${UiUnicodeSymbols.error} - Value "${token.value}" validation failed.`
                )

            case 'wait-next-inited':
                return new EvaluationResult(
                    this.parser,
                    `Waiting for next value.`,
                )

            default:
                return new EvaluationResult(
                    this.parser,
                    `${UiUnicodeSymbols.error} - Unexpected action: "${action}" on token "${JSON.stringify(token)}"`,
                    { done: true, error: `Unexpected action: ${action}`, addTo: 'end' }
                )
        }
    }

    protected end() {
        return new EvaluationResult(
            this.parser,
            '',
            {done: true}
        )
    }

    protected compile(): ICommandCompiled {
        return {
            command: this.parser.Command,
            proxy: new CmdArgumentProxy(this.parser.ReadArgs),
            raw: this.parser.ReadArgs
        }
    }
}
