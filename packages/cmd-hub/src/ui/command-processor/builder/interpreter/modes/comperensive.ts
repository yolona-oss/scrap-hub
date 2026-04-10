import { EvaluationResult } from "../../ev-result"
import { BaseInterpreterComponent } from "./base"

/**
* Will runs until all arguments in descripter are read
*/
export class InterpreterModeComprehensive extends BaseInterpreterComponent {
    step(input: string) {
        const res = super.step(input)

        if (this.parser.isEveryArgumentsRead()) {
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
