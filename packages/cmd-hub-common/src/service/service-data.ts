import { CmdArgument, CommandArgumentKeyHolder, CommandMetadata, getCmdArgMetadata } from "../command";
import { DEFAULT_ACCOUNT_SESSION_NAME } from "./service-store";

export function toDescriptor<T extends CommandArgumentKeyHolder>(instance: T): CommandMetadata<keyof T> {
    return getCmdArgMetadata(instance)
}

export class GlobalServiceConfig {
}

export class GlobalServiceParam {
    @CmdArgument({
        required: false,
        description: "Session id to restore state from."
    })
    sessionId?: string

    @CmdArgument({
        required: false,
        description: "Session id to restore state from."
    })
    s?: string

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Disable auto-dashboard for this service"
    })
    noDashboard?: string
}

export class GlobalServiceMessages {
    @CmdArgument({
        required: false,
        description: "Echo message",
        defaultValue: "R U GAY?"
    })
    echo?: string
}

/**
 * @description Data holder object
 * @param sessionId - must be set after initialization
 * @param sessionData - must be set after initialization
 */
export class CmdServiceData<
        TConfig extends Object = GlobalServiceConfig,
        TParams extends Object = GlobalServiceParam,
        TMessages extends Object = GlobalServiceMessages,
        TSessionData extends Object = {}
    >
{
    constructor(
        public config: TConfig,
        public params: TParams,
        public messages: TMessages,
        public sessionId: string = DEFAULT_ACCOUNT_SESSION_NAME,
        public sessionData: TSessionData = {} as TSessionData
    ) { }
}
