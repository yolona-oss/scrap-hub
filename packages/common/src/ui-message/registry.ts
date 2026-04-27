import log from '../application/logger'
import type { UiMessage } from './types'
import type { UiUiMessageKindPlugin, UiRenderContext } from './kind-plugin'
import { renderToText } from './reference-renderer'

const MAX_RECURSION_DEPTH = 5

export interface IUiMessageRendererRegistry {
    /** Add a render-half plugin. The last registration wins on duplicate
     *  `kind` (services may want to override a builtin) — emits a debug
     *  log so accidental shadowing is visible. */
    register<P, RenderOut = unknown>(plugin: UiUiMessageKindPlugin<P, RenderOut>): void
    has(kind: string): boolean
    /** Apply the registered render-half. Falls back to the framework's
     *  text reference renderer when the kind has no registered plugin
     *  (logs a warning once per unknown kind). */
    render(msg: UiMessage, ctx: Omit<UiRenderContext, 'render' | 'depth'>): unknown
    /** All registered kind names. UIs use this to derive their
     *  `federationRequires.supported` capability list. */
    registeredKinds(): string[]
}

/** Per-UI renderer registry. Each UI plugin instantiates one and registers
 *  its render-halves at boot. The framework's `useUiMessageKind` walks all
 *  UIs and calls `register` on each (when the plugin has a render half). */
export class UiMessageRendererRegistry implements IUiMessageRendererRegistry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly renderers = new Map<string, UiUiMessageKindPlugin<any, any>>()
    private readonly warnedUnknownKinds = new Set<string>()

    constructor(public readonly uiName: string) {}

    register<P, RenderOut = unknown>(plugin: UiUiMessageKindPlugin<P, RenderOut>): void {
        if (this.renderers.has(plugin.kind)) {
            log.debug(`UiMessageRendererRegistry[${this.uiName}]: replacing renderer for kind "${plugin.kind}"`)
        }
        this.renderers.set(plugin.kind, plugin)
    }

    has(kind: string): boolean {
        return this.renderers.has(kind)
    }

    render(msg: UiMessage, baseCtx: Omit<UiRenderContext, 'render' | 'depth'>): unknown {
        return this.renderInternal(msg, baseCtx, 0)
    }

    registeredKinds(): string[] {
        return [...this.renderers.keys()]
    }

    private renderInternal(
        msg: UiMessage,
        baseCtx: Omit<UiRenderContext, 'render' | 'depth'>,
        depth: number,
    ): unknown {
        if (depth >= MAX_RECURSION_DEPTH) {
            log.warn(`UiMessageRendererRegistry[${this.uiName}]: recursion cap (${MAX_RECURSION_DEPTH}) hit at kind "${msg.kind}"`)
            return `[depth-cap]`
        }

        const ctx: UiRenderContext = {
            ...baseCtx,
            depth,
            // Children pass severity=undefined so a styled outer envelope
            // doesn't leak its color into nested entries (e.g. a list of
            // mixed-severity items).
            severity: depth === 0 ? msg.severity : undefined,
            render: (child) => this.renderInternal(child, baseCtx, depth + 1),
        }

        const plugin = this.renderers.get(msg.kind)
        if (plugin) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const { kind: _kind, severity: _sev, ...payload } = msg as any
            return plugin.render(payload, ctx)
        }

        if (!this.warnedUnknownKinds.has(msg.kind)) {
            this.warnedUnknownKinds.add(msg.kind)
            log.warn(`UiMessageRendererRegistry[${this.uiName}]: no renderer for kind "${msg.kind}"; falling back to text`)
        }
        return renderToText(msg, ctx)
    }
}
