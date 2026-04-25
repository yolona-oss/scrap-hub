import type { BaseUIContext } from './context'
import type { IUI } from './types'

/**
 * Pluggable auth gate. UIs whose platform delivers raw events (Telegraf
 * callback, Express request, Socket.IO event) call `identify(raw)` to extract
 * the user-id-shaped key. If `identify` returns null OR the manager lookup
 * misses, the gate's `challenge(raw, ui)` runs whatever sign-in UX the
 * platform wants (Telegram inline button, Web login form, …).
 *
 * The contract is deliberately minimal — Telegram and Web today need only
 * these three hooks. Don't add scopes / roles / OAuth knobs without a real
 * consumer.
 */
export interface IAuthGate<RawCtx, Ctx extends BaseUIContext = BaseUIContext> {
    /** Resolve a user-id lookup from the raw platform event, or null to
     *  skip the manager lookup entirely (e.g. unauthenticated paths). */
    identify(raw: RawCtx): Promise<{ userIdLookup: string | number } | null>

    /** Render a sign-in UX. Called when a manager wasn't found for
     *  `identify`'s lookup. The gate decides what counts as "found"
     *  by virtue of the lookup it returned. */
    challenge(raw: RawCtx, ui: IUI<Ctx>): Promise<void>

    /** Optional bypass — return true for raw events that must proceed
     *  WITHOUT identification (e.g. callbacks during sign-up). */
    isExempt?(raw: RawCtx): boolean
}
