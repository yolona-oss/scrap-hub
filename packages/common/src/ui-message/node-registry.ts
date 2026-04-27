import log from '../application/logger'
import type { UiMessage, UiMessageKindMap, UiSeverity } from './types'
import type { NodeUiMessageKindPlugin } from './kind-plugin'

export interface INodeUiMessageRegistry {
    /** Register a node-side build half. Last registration wins on
     *  duplicate kind (debug-logged). */
    register<P>(plugin: NodeUiMessageKindPlugin<P>): void
    /** Returns the registered plugin or null. The wire layer needs this
     *  to look up `compatibilityId`/`version` when serializing an
     *  envelope. */
    lookup(kind: string): NodeUiMessageKindPlugin<unknown> | null
    /** Type-safe builder. Compile-time check on `kind` against the
     *  augmented kind map. */
    build<K extends keyof UiMessageKindMap>(
        kind: K,
        payload: UiMessageKindMap[K],
        severity?: UiSeverity,
    ): UiMessage
    /** Every kind this node may emit; published in `NodeManifest.publishedCapabilities`. */
    registeredKinds(): string[]
}

export class NodeUiMessageRegistry implements INodeUiMessageRegistry {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly plugins = new Map<string, NodeUiMessageKindPlugin<any>>()

    register<P>(plugin: NodeUiMessageKindPlugin<P>): void {
        if (this.plugins.has(plugin.kind)) {
            log.debug(`NodeUiMessageRegistry: replacing builder for kind "${plugin.kind}"`)
        }
        this.plugins.set(plugin.kind, plugin)
    }

    lookup(kind: string): NodeUiMessageKindPlugin<unknown> | null {
        return this.plugins.get(kind) ?? null
    }

    build<K extends keyof UiMessageKindMap>(
        kind: K,
        payload: UiMessageKindMap[K],
        severity?: UiSeverity,
    ): UiMessage {
        const plugin = this.plugins.get(kind as string)
        if (!plugin) {
            throw new Error(`NodeUiMessageRegistry.build: kind "${String(kind)}" not registered. Call app.useUiMessageKind(...) at boot.`)
        }
        return plugin.build(payload as unknown, severity)
    }

    registeredKinds(): string[] {
        return [...this.plugins.keys()]
    }
}
