import type { UiMessage, UiSeverity } from './types'
import type {
    FullUiMessageKindPlugin,
    NodeUiMessageKindPlugin,
    UiUiMessageKindPlugin,
} from './kind-plugin'
import { renderToText } from './reference-renderer'

/** Compatibility-id prefix shared by every framework-supplied builtin.
 *  Independent plugins MUST NOT use this prefix — it'd defeat the
 *  federation mismatch check. */
export const BUILTIN_COMPAT_PREFIX = 'cmd-hub.builtin'
export const BUILTIN_VERSION = '1.0.0'

function builtinId(kind: string): string {
    return `${BUILTIN_COMPAT_PREFIX}.${kind}`
}

/** Helper for declaring a builtin: shared compatibilityId/version + a
 *  default `build` that just slots the payload into a UiMessage. The
 *  node-side and UI-side halves always share the same identity, so
 *  builtin plugins are full plugins (both halves in one object). */
function makeBuiltin<P>(
    kind: string,
    render: UiUiMessageKindPlugin<P, string>['render'],
): FullUiMessageKindPlugin<P, string> {
    return {
        kind,
        compatibilityId: builtinId(kind),
        version: BUILTIN_VERSION,
        build(payload: P, severity?: UiSeverity): UiMessage {
            // Builtin payloads are flat, so the spread is safe; plugin
            // authors with discriminated payloads should override `build`.
            return { kind, severity, ...(payload as object) } as UiMessage
        },
        render,
    }
}

/** `text` — every UI MUST register a renderer for this. Framework
 *  auto-registers it on every UI at `Phase.UI`. */
export const BuiltinTextKind = makeBuiltin<{ text: string }>(
    'text',
    (payload) => payload.text,
)

/** `code` — monospace block. Framework auto-registers on every UI; the
 *  default render is the raw code string. */
export const BuiltinCodeKind = makeBuiltin<{ code: string, language?: string }>(
    'code',
    (payload) => payload.code,
)

/** `markdown` — opt-in. UIs that don't render Markdown natively call
 *  `renderToText` via the reference fallback. */
export const BuiltinMarkdownKind = makeBuiltin<{ md: string }>(
    'markdown',
    (payload, ctx) => renderToText({ kind: 'markdown', md: payload.md }, ctx) as string,
)

/** `list` — opt-in. Default rendering bullets the children using the
 *  active context's recursive renderer. */
export const BuiltinListKind = makeBuiltin<{ items: UiMessage[] }>(
    'list',
    (payload, ctx) => payload.items.map(item => `• ${String(ctx.render(item) ?? '')}`).join('\n'),
)

/** `kv` — opt-in. Default rendering is `key: value` lines. */
export const BuiltinKvKind = makeBuiltin<{ pairs: Array<{ key: string, value: string }> }>(
    'kv',
    (payload) => payload.pairs.map(p => `${p.key}: ${p.value}`).join('\n'),
)

/** `link` — opt-in. */
export const BuiltinLinkKind = makeBuiltin<{ text: string, url: string }>(
    'link',
    (payload) => `${payload.text} (${payload.url})`,
)

/** Builtins the framework auto-registers on every UI. Per the hybrid
 *  decision: `text` and `code` are guaranteed; the rest are opt-in. */
export const ESSENTIAL_BUILTIN_PLUGINS: ReadonlyArray<FullUiMessageKindPlugin<unknown, string>> = [
    BuiltinTextKind as FullUiMessageKindPlugin<unknown, string>,
    BuiltinCodeKind as FullUiMessageKindPlugin<unknown, string>,
]

/** Optional builtins UIs may opt into via `registerBuiltinRenderers`. */
export const OPTIONAL_BUILTIN_PLUGINS: ReadonlyArray<FullUiMessageKindPlugin<unknown, string>> = [
    BuiltinMarkdownKind as FullUiMessageKindPlugin<unknown, string>,
    BuiltinListKind as FullUiMessageKindPlugin<unknown, string>,
    BuiltinKvKind as FullUiMessageKindPlugin<unknown, string>,
    BuiltinLinkKind as FullUiMessageKindPlugin<unknown, string>,
]

/** All builtins, both halves — useful for node-side registries that
 *  always want every builtin emitable. */
export const ALL_BUILTIN_PLUGINS: ReadonlyArray<NodeUiMessageKindPlugin<unknown>> = [
    ...ESSENTIAL_BUILTIN_PLUGINS,
    ...OPTIONAL_BUILTIN_PLUGINS,
]
