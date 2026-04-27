import type { UiMessage, UiMessageKindMap, UiSeverity } from './types'

/** The shared half of a UiMessage kind plugin — common to both node-side
 *  emit and UI-side render. Two plugins claiming the same `kind` but
 *  different `compatibilityId` are rejected at federation time, exactly
 *  the way `CommandPool` rejects mismatched command compatibilityIds. */
export interface UiMessageKindPlugin<P = unknown> {
    /** Wire discriminator. Same string is the capability-key suffix
     *  (`uiMessageKindCap(kind)`) and the proto envelope's `kind` field. */
    readonly kind: string
    /** Stable identity across versions; minor/patch bumps stay
     *  compatible, major bumps are breaking. */
    readonly compatibilityId: string
    readonly version: string  // semver
    /** Optional payload schema. When set, the framework validates inbound
     *  payloads at the wire boundary and outbound payloads at emit time. */
    readonly schema?: import('zod').ZodType<P>
}

/** Node-side half: knows how to assemble a `UiMessage` from a typed payload. */
export interface NodeUiMessageKindPlugin<P> extends UiMessageKindPlugin<P> {
    /** Type-safe builder. Service code calls `app.uiMessages.<kind>(payload)`
     *  rather than assembling a raw envelope, so the wire contract stays
     *  single-sourced. */
    build(payload: P, severity?: UiSeverity): UiMessage
}

/** Render context handed to `UiUiMessageKindPlugin.render`. Carries the
 *  active UI flavor so a single plugin can branch on it (or, more often,
 *  ship distinct plugin objects per UI), and a `render(child)` callback
 *  for kinds that nest other UiMessages (e.g. `list`). */
export interface UiRenderContext {
    /** Which UI flavor is invoking the render. */
    readonly ui: 'cli' | 'telegram' | 'web' | (string & {})
    /** Recursive renderer for nested children. UIs that produce non-string
     *  output (e.g. a future React-element renderer) define their own
     *  `RenderOut`; the recursive call returns the same `RenderOut`. */
    render(child: UiMessage): unknown
    /** Soft cap on recursion depth to prevent runaway nested lists from
     *  blowing the stack. Framework default is 5; renderers MAY check
     *  this if they want to short-circuit before re-entry. */
    readonly depth: number
    /** Severity of the message currently being rendered, if set on the
     *  outer envelope. Render-halves use this to apply platform styling
     *  (CLI ANSI, Telegram icons, etc.). Undefined for nested children. */
    readonly severity?: UiSeverity
}

/** UI-side half: knows how to render a payload to that UI's native output. */
export interface UiUiMessageKindPlugin<P, RenderOut = unknown> extends UiMessageKindPlugin<P> {
    render(payload: P, ctx: UiRenderContext): RenderOut
}

/** Convenience type guard: a plugin object that has both halves (one
 *  package can ship the same plugin to a node-side and a UI-side app). */
export type FullUiMessageKindPlugin<P, RenderOut = unknown> =
    NodeUiMessageKindPlugin<P> & UiUiMessageKindPlugin<P, RenderOut>

export function isNodeKindPlugin(p: unknown): p is NodeUiMessageKindPlugin<unknown> {
    return typeof p === 'object' && p !== null
        && typeof (p as NodeUiMessageKindPlugin<unknown>).build === 'function'
}

export function isUiKindPlugin(p: unknown): p is UiUiMessageKindPlugin<unknown> {
    return typeof p === 'object' && p !== null
        && typeof (p as UiUiMessageKindPlugin<unknown>).render === 'function'
}

/** Helper that asserts a `kind` literal is in the augmented map. Prevents
 *  typos in plugin definitions. */
export type KindOf<P extends keyof UiMessageKindMap> = P
