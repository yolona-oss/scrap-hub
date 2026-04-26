import { CmdArgument, CommandArgumentKeyHolder, CommandMetadata, getCmdArgMetadata } from "../command";
import { DEFAULT_ACCOUNT_SESSION_NAME } from "./service-store";

export function toDescriptor<T extends CommandArgumentKeyHolder>(instance: T): CommandMetadata<keyof T> {
    return getCmdArgMetadata(instance)
}

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
    noCache?: void
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
 * @description Holder for the four data slices a service operates on:
 *
 * - `config` — merged effective config (defaults ← account ← session ← input).
 *   Same field name carries both the "raw input" shape (when used as
 *   `Partial<ServiceDataType>`) and the "merged effective" shape (when used
 *   as `ServiceDataType` post-`initSession`). Read sites that want to
 *   highlight the merged-after-init meaning can use `effectiveConfig`.
 * - `params` — runtime params (sessionId, dashboard flags, etc.).
 * - `messages` — message-context args that the running service receives.
 * - `runtimeState` — resumable state the service writes during a run
 *   (e.g., scraper's collected results + processed URLs). Distinct from
 *   the session-layer config overlay.
 *
 * @param sessionId - must be set after initialization
 * @param runtimeState - persisted between runs of the same session
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

    /** Read-side alias for {@link config}. After `initSession`, `config`
     *  IS the merged effective config; this getter just renames at the
     *  consumer for clarity. */
    get effectiveConfig(): TConfig { return this.config }
}
