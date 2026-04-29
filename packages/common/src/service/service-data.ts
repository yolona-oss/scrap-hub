import { CmdArg } from "../command";
import { DEFAULT_ACCOUNT_SESSION_NAME } from "./service-store";

export class GlobalServiceArgs {
    @CmdArg({
        required: false,
        description: "Session id to restore state from."
    })
    sessionId?: string

    @CmdArg({
        required: false,
        standalone: true,
        description: "Disable auto-dashboard for this service"
    })
    noDashboard?: string

    @CmdArg({
        required: false,
        standalone: true,
        description: "Skip per-account/session arg overlays for this run; use built-in defaults + explicit args only. Saved values are NOT modified.",
    })
    noCache?: string

    @CmdArg({
        required: false,
        standalone: true,
        description: "Skip the builder. Run immediately using saved session/state data merged with any typed args. Falls back to the builder when required args are missing.",
    })
    now?: string
}

export class GlobalServiceIntercom {
    @CmdArg({
        required: false,
        description: "Echo message",
        default: "echo",
    })
    echo?: string
}

/**
 * Holder for the three data slices a service operates on:
 *
 * - `args`     — merged effective arguments. Persistent leaves were
 *                read from defaults ← account ← session ← input;
 *                ephemeral leaves came straight from input.
 * - `intercom` — args for in-band reverse-channel messages
 *                (pause/resume/stop/custom action ids).
 * - `state`    — resumable state the service writes during a run.
 */
export class CmdServiceData<
        TArgs extends Object = GlobalServiceArgs,
        TIntercom extends Object = GlobalServiceIntercom,
        TState extends Object = {}
    >
{
    constructor(
        public args: TArgs,
        public intercom: TIntercom,
        public sessionId: string = DEFAULT_ACCOUNT_SESSION_NAME,
        public state: TState = {} as TState,
    ) { }

    /** Read-side alias for {@link args}. */
    get effectiveArgs(): TArgs { return this.args }
}
