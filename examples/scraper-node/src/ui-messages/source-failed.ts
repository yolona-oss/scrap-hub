import type {
    FullUiMessageKindPlugin,
    UiUiMessageKindPlugin,
    UiMessage,
    UiSeverity,
    IUiMessageRendererRegistry,
} from '@cmd-hub/common'

/** Module-augment so `{kind: 'sourceFailed', ...}` becomes a known
 *  UiMessage shape downstream. Services emit via `this.send(...)` and
 *  UIs render through the registered render-half; one channel for every
 *  user-facing message. */
declare module '@cmd-hub/common' {
    interface CustomUiMessageKinds {
        'sourceFailed': {
            source: string
            reason: string
            mode: 'unavailable' | 'thrown'
        }
    }
}

const KIND = 'sourceFailed'
const COMPAT = 'com.example.scraper.source-failed'
const VERSION = '1.0.0'

type Payload = { source: string, reason: string, mode: 'unavailable' | 'thrown' }

export const SourceFailedKind: FullUiMessageKindPlugin<Payload, string> = {
    kind: KIND,
    compatibilityId: COMPAT,
    version: VERSION,
    build(payload: Payload, severity?: UiSeverity): UiMessage {
        return { kind: 'sourceFailed', severity: severity ?? 'warn', ...payload } as UiMessage
    },
    render(payload: Payload): string {
        const icon = payload.mode === 'unavailable' ? '⊘' : '✗'
        return `${icon} ${payload.source} (${payload.mode}): ${payload.reason}`
    },
}

export const SourceFailedKindTelegram: UiUiMessageKindPlugin<Payload, string> = {
    kind: KIND,
    compatibilityId: COMPAT,
    version: VERSION,
    render(payload: Payload): string {
        const escape = (s: string) =>
            s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        const icon = payload.mode === 'unavailable' ? '⊘' : '✗'
        return `${icon} <b>${escape(payload.source)}</b> <i>(${payload.mode})</i>: ${escape(payload.reason)}`
    },
}

export function registerSourceFailedKind(registry: IUiMessageRendererRegistry, ui: 'cli' | 'telegram' | 'web' | string): void {
    if (ui === 'telegram') {
        registry.register(SourceFailedKindTelegram)
    } else {
        registry.register(SourceFailedKind)
    }
}
