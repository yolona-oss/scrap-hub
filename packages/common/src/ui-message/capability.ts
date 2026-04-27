import { CapabilityKey, defineCapability } from '../application/capability'
import type { INodeUiMessageRegistry } from './node-registry'
import type { IUiMessageRendererRegistry } from './registry'

/** Cap-key for a single UiMessage kind. Nodes publish one of these per
 *  kind they may emit; UIs declare them in `federationRequires.supported`
 *  per kind they can render. The string suffix matches the wire
 *  discriminator — single source of truth for compatibility decisions. */
export function uiMessageKindCap(kind: string): CapabilityKey<unknown> {
    return defineCapability(`cmd-hub.ui-message.kind.${kind}`)
}

/** Provided by the framework on node-side apps. Plugins use this at boot
 *  to register their node-side build halves. Services don't typically read
 *  this directly — they call `BaseCommandService.send(msg)` which goes
 *  through `'uiMessage'` event. */
export const CAP_NodeUiMessageRegistry =
    defineCapability<INodeUiMessageRegistry>('cmd-hub.ui-message.node-registry')

/** Provided by the framework on hub-side apps. Returns a facade over
 *  per-UI registries; most consumers should resolve a specific UI's
 *  registry from `CmdHubApp.UIs[i]` rather than the facade. */
export const CAP_UiMessageRendererRegistry =
    defineCapability<IUiMessageRendererRegistry>('cmd-hub.ui-message.renderer-registry')
