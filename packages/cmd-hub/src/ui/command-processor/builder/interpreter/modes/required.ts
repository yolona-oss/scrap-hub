import log from "@core/application/logger"
import { EvaluationResult } from "../../ev-result"
import { BaseInterpreterComponent } from "./base"

/**
* Will runs until all required arguments in descripter are read
*/
export class InterpreterModeRequired extends BaseInterpreterComponent {
    step(input: string) {
        const res = super.step(input)

        if (this.parser.isRequiredArgumentsRead()) {
            const compiled = this.compile()
            return new EvaluationResult(
                this.parser,
                `Building command`,
                {compiled: compiled, addTo: "end"}
            )
        }

        return res
    }
}
