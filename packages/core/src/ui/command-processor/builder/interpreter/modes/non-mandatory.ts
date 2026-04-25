import { UiUnicodeSymbols } from "../../../../../ui/ui-unicode-symbols"
import { EvaluationResult } from "../../ev-result"
import { BaseInterpreterComponent } from "./base"
import log from "../../../../../application/logger"

/**
* Gets all argumets once then parse all of them
*/
export class InterpreterModeNonMandatory extends BaseInterpreterComponent {
    step(casulaInput: string) {
        super.step(casulaInput)
        const compiled = this.compile()
        return new EvaluationResult(
            this.parser,
            `Inclusive build done ${UiUnicodeSymbols.hammer}`,
            {compiled}
        )
    }
}
