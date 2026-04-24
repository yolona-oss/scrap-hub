/**
 * Capability keys for hub-tier objects. The RemoteCmdInvoker is owned by
 * the hub (per-dispatcher, per-UI), so its key lives here rather than in
 * @cmd-hub/transport.
 */
import { defineCapability } from '@cmd-hub/common'
import type { RemoteCmdInvoker } from './ui/command-processor/remote-invoker'

export const CAP_RemoteCmdInvoker = defineCapability<RemoteCmdInvoker>('hub.remoteCmdInvoker')
