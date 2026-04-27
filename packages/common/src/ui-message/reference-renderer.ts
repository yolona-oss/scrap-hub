import type { UiMessage } from './types'
import type { UiRenderContext } from './kind-plugin'

/** Strip Markdown formatting to plain text. Best-effort; preserves the
 *  visible content. Used by UIs that don't natively render Markdown. */
function stripMarkdown(md: string): string {
    return md
        .replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, '').trim())
        .replace(/`([^`]+)`/g, '$1')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/__([^_]+)__/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/_([^_]+)_/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
        .replace(/^#{1,6}\s+/gm, '')
        .trim()
}

/** Default plain-text rendering for the framework's builtin kinds. Every
 *  UI gets this for free as the fallback when a kind has no registered
 *  renderer. UIs that want to override (e.g. CLI's columnar `kv`) register
 *  their own UiUiMessageKindPlugin. */
export function renderToText(msg: UiMessage, ctx: UiRenderContext): string {
    switch (msg.kind) {
        case 'text': return msg.text
        case 'markdown': return stripMarkdown(msg.md)
        case 'code': return msg.code
        case 'list': return msg.items.map(child => `• ${stringify(ctx.render(child))}`).join('\n')
        case 'kv': return msg.pairs.map(p => `${p.key}: ${p.value}`).join('\n')
        case 'link': return `${msg.text} (${msg.url})`
        default: {
            // Plugin-augmented kind without a registered renderer. Surface
            // payload as JSON so an operator can still see what was sent.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { kind, severity: _sev, ...payload } = msg as any
            return `[${kind}] ${JSON.stringify(payload)}`
        }
    }
}

function stringify(v: unknown): string {
    return typeof v === 'string' ? v : String(v ?? '')
}
