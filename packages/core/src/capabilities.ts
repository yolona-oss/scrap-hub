/**
 * Capability keys for hub-tier objects. The RemoteCmdInvoker is owned by
 * the hub (per-dispatcher, per-UI), so its key lives here rather than in
 * @cmd-hub/transport.
 */
import { defineCapability } from '@cmd-hub/common'
import type { CapabilityKey } from '@cmd-hub/common'
import type { RemoteCmdInvoker } from './ui/command-processor/remote-invoker'

export const CAP_RemoteCmdInvoker = defineCapability<RemoteCmdInvoker>('hub.remoteCmdInvoker')

/** Payload published by `FederationCapsMiddleware`. App-level federation
 *  requirements: validated essentials and (auto-filled or explicit) supported. */
export interface FederationRequiresPayload {
    readonly essential: ReadonlyArray<CapabilityKey<unknown>>
    readonly supported: ReadonlyArray<CapabilityKey<unknown>>
}

export const CAP_FederationRequires =
    defineCapability<FederationRequiresPayload>('hub.federationRequires')
