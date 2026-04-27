import type { UiSeverity } from '../ui-message/types'
import { UiUnicodeSymbols } from './unicode-symbols'

/** Severity → framework symbol. Sourced from `UiUnicodeSymbols` so the icon
 *  set stays consistent across UIs. Per-UI text renderers compose this with
 *  their platform styling (ANSI for CLI, HTML escapes for Telegram, JSON
 *  envelope for web). */
export const SEVERITY_ICON: Record<UiSeverity, string> = {
    error:   UiUnicodeSymbols.error,
    warn:    UiUnicodeSymbols.warning,
    success: UiUnicodeSymbols.success,
    info:    UiUnicodeSymbols.info,
}

/** Rendered as `${icon} ` when severity is set, empty string otherwise. */
export function severityIconPrefix(sev: UiSeverity | undefined): string {
    return sev ? `${SEVERITY_ICON[sev]} ` : ''
}
