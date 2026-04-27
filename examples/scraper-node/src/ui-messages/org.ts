import type {
    FullUiMessageKindPlugin,
    UiUiMessageKindPlugin,
    UiMessage,
    UiSeverity,
    IUiMessageRendererRegistry,
} from '@cmd-hub/common'

/** Augment the framework's UiMessage union so `'org'` becomes a known kind
 *  everywhere downstream. The compatibility id is independent from the
 *  framework's `cmd-hub.builtin.*` namespace. */
declare module '@cmd-hub/common' {
    interface CustomUiMessageKinds {
        'org': {
            name: string
            phone?: string | null
            email?: string | null
            address?: string | null
            url?: string
            source?: string
        }
    }
}

const KIND = 'org'
const COMPAT = 'com.example.scraper.org'
const VERSION = '1.0.0'

type OrgPayload = {
    name: string
    phone?: string | null
    email?: string | null
    address?: string | null
    url?: string
    source?: string
}

/** Node-side + UI-side full plugin. The `build` half is what services call
 *  via `this.send(OrgKind.build({...}))`; the `render` half is overridden
 *  by each UI plugin (Telegram registers its own HTML renderer). The
 *  default render here is the CLI/web text fallback. */
export const OrgKind: FullUiMessageKindPlugin<OrgPayload, string> = {
    kind: KIND,
    compatibilityId: COMPAT,
    version: VERSION,
    build(payload: OrgPayload, severity?: UiSeverity): UiMessage {
        return { kind: 'org', severity, ...payload } as UiMessage
    },
    render(payload: OrgPayload): string {
        const parts = [payload.name]
        if (payload.phone) parts.push(payload.phone)
        if (payload.email) parts.push(payload.email)
        if (payload.address) parts.push(payload.address)
        if (payload.url) parts.push(`<${payload.url}>`)
        const tag = payload.source ? ` [${payload.source}]` : ''
        return `· ${parts.filter(Boolean).join(' · ')}${tag}`
    },
}

/** Telegram registers a richer HTML renderer instead of the default text
 *  one; this returns an HTML contact-card-ish layout. Hub-side wiring
 *  swaps the default `OrgKind` with `OrgKindTelegram` inside the Telegram
 *  UI's own renderer registry. */
export const OrgKindTelegram: UiUiMessageKindPlugin<OrgPayload, string> = {
    kind: KIND,
    compatibilityId: COMPAT,
    version: VERSION,
    render(payload: OrgPayload): string {
        const escape = (s: string) =>
            s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const escapeAttr = (s: string) => escape(s).replace(/"/g, '&quot;')
        const lines: string[] = [`<b>${escape(payload.name)}</b>`]
        if (payload.phone) lines.push(`📞 <code>${escape(payload.phone)}</code>`)
        if (payload.email) lines.push(`✉️ <code>${escape(payload.email)}</code>`)
        if (payload.address) lines.push(`📍 ${escape(payload.address)}`)
        if (payload.url) lines.push(`🔗 <a href="${escapeAttr(payload.url)}">link</a>`)
        if (payload.source) lines.push(`<i>via ${escape(payload.source)}</i>`)
        return lines.join('\n')
    },
}

/** Convenience: pick the right render-half per UI flavor and register it.
 *  Apps call this from their bootstrap once per UI. */
export function registerOrgKind(registry: IUiMessageRendererRegistry, ui: 'cli' | 'telegram' | 'web' | string): void {
    if (ui === 'telegram') {
        registry.register(OrgKindTelegram)
    } else {
        registry.register(OrgKind)
    }
}
