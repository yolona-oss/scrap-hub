import type {
    IUiMessageRendererRegistry,
    UiUiMessageKindPlugin,
    UiMessage,
} from '@cmd-hub/common'
import { BUILTIN_COMPAT_PREFIX, BUILTIN_VERSION, severityIconPrefix } from '@cmd-hub/common'

const VERSION = BUILTIN_VERSION

/** Escape HTML-significant characters for Telegram's `parseMode: 'HTML'`.
 *  Telegram's HTML allows a small subset (b, i, u, s, code, pre, a) so
 *  user-controlled text must be escaped to avoid breaking the markup. */
function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
    return escapeHtml(s).replace(/"/g, '&quot;')
}

/** Convert a small Markdown subset to Telegram-HTML. Permissive: unknown
 *  constructs are dropped rather than escaped, since this is the full
 *  intended rendering for kind=markdown. */
function markdownToTgHtml(md: string): string {
    let out = escapeHtml(md)
    // Code fences (```lang\n...```)
    out = out.replace(/```(\w+)?\n([\s\S]*?)```/g, (_m, _lang, code) => `<pre>${code}</pre>`)
    // Inline code
    out = out.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    // Bold **text** and __text__
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    out = out.replace(/__([^_\n]+)__/g, '<b>$1</b>')
    // Italic *text* and _text_
    out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    out = out.replace(/(^|[^_])_([^_\n]+)_/g, '$1<i>$2</i>')
    // Links [text](url)
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
        `<a href="${escapeAttr(url)}">${escapeHtml(text)}</a>`)
    return out
}

const TextKind: UiUiMessageKindPlugin<{ text: string }, string> = {
    kind: 'text',
    compatibilityId: `${BUILTIN_COMPAT_PREFIX}.text`,
    version: VERSION,
    render: (payload, ctx) => `${severityIconPrefix(ctx.severity)}${escapeHtml(payload.text)}`,
}

const CodeKind: UiUiMessageKindPlugin<{ code: string, language?: string }, string> = {
    kind: 'code',
    compatibilityId: `${BUILTIN_COMPAT_PREFIX}.code`,
    version: VERSION,
    render: (payload) => `<pre>${escapeHtml(payload.code)}</pre>`,
}

const MarkdownKind: UiUiMessageKindPlugin<{ md: string }, string> = {
    kind: 'markdown',
    compatibilityId: `${BUILTIN_COMPAT_PREFIX}.markdown`,
    version: VERSION,
    render: (payload) => markdownToTgHtml(payload.md),
}

const ListKind: UiUiMessageKindPlugin<{ items: UiMessage[] }, string> = {
    kind: 'list',
    compatibilityId: `${BUILTIN_COMPAT_PREFIX}.list`,
    version: VERSION,
    render: (payload, ctx) => payload.items
        .map((item) => `• ${String(ctx.render(item) ?? '')}`)
        .join('\n'),
}

const KvKind: UiUiMessageKindPlugin<
    { pairs: Array<{ key: string, value: string }> },
    string
> = {
    kind: 'kv',
    compatibilityId: `${BUILTIN_COMPAT_PREFIX}.kv`,
    version: VERSION,
    render: (payload) => payload.pairs
        .map((p) => `<b>${escapeHtml(p.key)}</b>: ${escapeHtml(p.value)}`)
        .join('\n'),
}

const LinkKind: UiUiMessageKindPlugin<{ text: string, url: string }, string> = {
    kind: 'link',
    compatibilityId: `${BUILTIN_COMPAT_PREFIX}.link`,
    version: VERSION,
    render: (payload) => `<a href="${escapeAttr(payload.url)}">${escapeHtml(payload.text)}</a>`,
}

/** Register Telegram-HTML renderers for every framework builtin. The
 *  framework's auto-registered text/code defaults from `useUI()` get
 *  replaced with these HTML versions. */
export function registerTelegramRenderers(registry: IUiMessageRendererRegistry): void {
    registry.register(TextKind)
    registry.register(CodeKind)
    registry.register(MarkdownKind)
    registry.register(ListKind)
    registry.register(KvKind)
    registry.register(LinkKind)
}
