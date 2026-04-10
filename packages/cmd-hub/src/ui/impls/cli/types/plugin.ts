import { IUIPlugin } from "@core/ui/types/plugin"
import { CLIContext } from "./context"

export interface ICLIPlugin extends IUIPlugin<CLIContext> {
    /** Extend tab-completion list */
    extendCompletions?(existing: string[]): string[]
    /** Intercept raw input before dispatch. Return false to consume, string to modify. */
    onRawInput?(line: string): Promise<string | false>
}
