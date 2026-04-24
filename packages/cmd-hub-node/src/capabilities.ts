/**
 * Capability keys for node-tier objects. CmdNodeApp and node-side
 * middlewares publish these; HubClientMiddleware + InvokeServerMiddleware
 * consume them.
 */
import { defineCapability } from '@cmd-hub/common'
import type { CmdHubProto } from '@cmd-hub/transport'
import type { HubClient } from './runtime/hub-client'
import type { IExecutor, NodeGrpcServerHandle } from './runtime/invoke-server'
import type { MetricsCollector } from './manifest/metrics-collector'

/** Manifest this node publishes on Register. Built by CmdNodeApp from
 *  its registered services. Required by HubClientMiddleware. */
export const CAP_NodeManifest = defineCapability<CmdHubProto.NodeManifest>('node.manifest')

/** Executor bridging InvokeStart → a running service instance. Required
 *  by InvokeServerMiddleware. */
export const CAP_NodeExecutor = defineCapability<IExecutor>('node.executor')

/** The node's own gRPC server handle, once InvokeServerMiddleware has
 *  started it. */
export const CAP_NodeInvokeServer = defineCapability<NodeGrpcServerHandle>('node.invokeServer')

/** Listen address (host:port) of the node's own InvokeServer — sent to
 *  the hub on Register so it can dial back. */
export const CAP_NodeInvokeBoundAddress = defineCapability<string>('node.invokeBoundAddress')

/** Live HubClient instance (post-Register, with heartbeat running). */
export const CAP_NodeHubClient = defineCapability<HubClient>('node.hubClient')

/** MetricsCollector the heartbeat stream samples. */
export const CAP_NodeMetricsCollector = defineCapability<MetricsCollector>('node.metricsCollector')
