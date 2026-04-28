import { CmdArgument } from "../command";
import { DEFAULT_ACCOUNT_SESSION_NAME } from "./service-store";

export class GlobalServiceConfig {}

export class GlobalServiceParam {
    @CmdArgument({
        required: false,
        description: "Session id to restore state from."
    })
    sessionId?: string

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Disable auto-dashboard for this service"
    })
    noDashboard?: string

    @CmdArgument({
        required: false,
        standalone: true,
        description: "Skip per-account/session config overlays for this run; use built-in defaults + explicit args only. Saved values are NOT modified.",
    })
    noCache?: string
}

export class GlobalServiceMessages {
    @CmdArgument({
        required: false,
        description: "Echo message",
        default: "echo",
    })
    echo?: string
}

/**
 * @description Holder for the four data slices a service operates on:
 *
 * - `config` — merged effective config (defaults ← account ← session ← input).
 * - `params` — runtime params (sessionId, dashboard flags, etc.).
 * - `messages` — message-context args that the running service receives.
 * - `runtimeState` — resumable state the service writes during a run
 *   (e.g., scraper's collected results + processed URLs).
 */
export class CmdServiceData<
        TConfig extends Object = GlobalServiceConfig,
        TParams extends Object = GlobalServiceParam,
        TMessages extends Object = GlobalServiceMessages,
        TRuntimeState extends Object = {}
    >
{
    constructor(
        public config: TConfig,
        public params: TParams,
        public messages: TMessages,
        public sessionId: string = DEFAULT_ACCOUNT_SESSION_NAME,
        public runtimeState: TRuntimeState = {} as TRuntimeState,
    ) { }

    /** Read-side alias for {@link config}. */
    get effectiveConfig(): TConfig { return this.config }
}
