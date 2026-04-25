/**
 * Capability keys for transport-tier objects (ManifestAggregator,
 * CmdNodeRegistry, FileService, etc.). Hub middlewares publish these;
 * hub built-ins and UIs consume them.
 *
 * Keep the key strings stable across versions — consumers in other
 * packages depend on them for `app.get(...)` lookups.
 */
import { defineCapability } from '@cmd-hub/common'
import type { CmdNodeRegistry } from './registry/cmd-node-registry'
import type { ManifestAggregator } from './pool/manifest-aggregator'
import type { FileService } from './files/file-service'
import type { MetricStore } from './metrics/metric-store'
import type { InMemoryChannelResolver } from './client/grpc-cmd-node-client'
import type { ICmdNodeClient } from './client/cmd-node-client'

/** Node registry — provisioning + approval state. Set by GrpcServerMiddleware. */
export const CAP_CmdNodeRegistry = defineCapability<CmdNodeRegistry>('transport.cmdNodeRegistry')

/** Manifest aggregator — every connected node's published commands + config modules. */
export const CAP_ManifestAggregator = defineCapability<ManifestAggregator>('transport.manifestAggregator')

/** File service — driver-agnostic façade over `CAP_FileBackend`. */
export const CAP_FileService = defineCapability<FileService>('transport.fileService')

/** Metric store — heartbeat snapshots keyed by nodeId. */
export const CAP_MetricStore = defineCapability<MetricStore>('transport.metricStore')

/** In-memory resolver mapping nodeId → gRPC channel. Populated on node
 *  register; consumed by GrpcCmdNodeClient. */
export const CAP_NodeChannelResolver = defineCapability<InMemoryChannelResolver>('transport.nodeChannelResolver')

/** Bound address string of the hub gRPC server (host:port). */
export const CAP_GrpcBoundAddress = defineCapability<string>('transport.grpcBoundAddress')

/** Hub-side client for invoking commands on nodes and sending ConfigReload. */
export const CAP_CmdNodeClient = defineCapability<ICmdNodeClient>('transport.cmdNodeClient')
