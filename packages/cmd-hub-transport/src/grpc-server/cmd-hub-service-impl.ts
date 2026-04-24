import * as grpc from '@grpc/grpc-js'
import type {
    CmdHubServiceServer,
    RegisterRequest,
    RegisterResponse,
    HeartbeatClient,
    HeartbeatServer,
    WriteGrantRequest,
    WriteGrant as ProtoWriteGrant,
    NodeManifest,
} from '../grpc/generated/cmd_node'
import type { CmdNodeRegistry } from '../registry/cmd-node-registry'
import type { ManifestAggregator, AggregatedManifest } from '../pool/manifest-aggregator'
import type { FileService } from '../files/file-service'
import type { MetricStore } from '../metrics/metric-store'

const HEARTBEAT_INTERVAL_MS = 15_000

/**
 * The fingerprint of the mTLS client cert is computed by the TLS layer and
 * made available here through an injected resolver. In v1 integration tests
 * that don't use mTLS the resolver simply returns the value the node passed
 * in a metadata header ("x-cmdhub-node-fingerprint") — sufficient to exercise
 * the registry's token+fingerprint contract.
 */
export type FingerprintResolver = (
    call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerDuplexStream<unknown, unknown>,
) => string | null

export interface CmdHubServiceDeps {
    registry: CmdNodeRegistry
    aggregator: ManifestAggregator
    fileService: FileService
    metrics: MetricStore
    /**
     * Called when a node registers successfully. Phase 2.3 uses this to open
     * an Invoke gRPC channel back to the node via its listen_address.
     */
    onNodeRegistered?: (nodeId: string, listenAddress: string) => void
    /**
     * Called when a node's stream tears down. Phase 2.3 closes the channel.
     */
    onNodeDisconnected?: (nodeId: string) => void
    /** See FingerprintResolver. Defaults to reading an x-cmdhub-node-fingerprint metadata header. */
    resolveFingerprint?: FingerprintResolver
}

function defaultFingerprintResolver(
    call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerDuplexStream<unknown, unknown>,
): string | null {
    const md = call.metadata.get('x-cmdhub-node-fingerprint')
    return md.length > 0 ? String(md[0]) : null
}

function toAggregated(m: NodeManifest): AggregatedManifest {
    return {
        nodeId: m.nodeId,
        nodeName: m.nodeName,
        version: m.version,
        commands: m.commands.map((c) => ({
            name: c.name,
            compatibilityId: c.compatibilityId,
            version: c.version,
            description: c.description,
            args: c.args,
            aliases: c.aliases,
        })),
        services: m.services,
        configs: m.configs.map((c) => ({ name: c.name, scope: c.scope, fields: c.fields })),
        hardware: m.hardware,
        metrics: m.metrics,
    }
}

export function makeCmdHubServiceImpl(deps: CmdHubServiceDeps): CmdHubServiceServer {
    const resolveFingerprint = deps.resolveFingerprint ?? defaultFingerprintResolver

    return {
        register(
            call: grpc.ServerUnaryCall<RegisterRequest, RegisterResponse>,
            callback: grpc.sendUnaryData<RegisterResponse>,
        ) {
            void (async () => {
                try {
                    const req = call.request
                    if (!req.manifest) {
                        callback({
                            code: grpc.status.INVALID_ARGUMENT,
                            message: 'RegisterRequest.manifest is required',
                        } as grpc.ServiceError, null)
                        return
                    }
                    const fp = resolveFingerprint(call)
                    if (!fp) {
                        callback({
                            code: grpc.status.UNAUTHENTICATED,
                            message: 'no client certificate fingerprint available',
                        } as grpc.ServiceError, null)
                        return
                    }

                    // Validate creds + transition registry state.
                    try {
                        await deps.registry.markRegistered(req.nodeId, {
                            presentedToken: req.token,
                            presentedFingerprint: fp,
                            manifestSnapshotId: `${req.nodeId}@${Date.now()}`,
                        })
                    } catch (err) {
                        callback({
                            code: grpc.status.UNAUTHENTICATED,
                            message: (err as Error).message,
                        } as grpc.ServiceError, null)
                        return
                    }

                    // Attach the manifest — rejection is an application error (400-ish).
                    const attach = deps.aggregator.attach(toAggregated(req.manifest))
                    if (!attach.ok) {
                        // Roll the registry back so reconnects are clean.
                        await deps.registry.deregister(req.nodeId).catch(() => undefined)
                        callback({
                            code: grpc.status.FAILED_PRECONDITION,
                            message: 'manifest rejected: ' + attach.rejected
                                .map((r) => `${r.command}: ${r.reason}`).join('; '),
                        } as grpc.ServiceError, null)
                        return
                    }

                    const rec = await deps.registry.get(req.nodeId)
                    const state = rec?.state ?? 'ACTIVE'

                    if (req.listenAddress) {
                        deps.onNodeRegistered?.(req.nodeId, req.listenAddress)
                    }

                    const response: RegisterResponse = {
                        sessionToken: '',
                        pollIntervalMs: HEARTBEAT_INTERVAL_MS,
                        assignedState: state === 'ACTIVE' ? 1 : state === 'PENDING' ? 0 : 2,
                    }
                    callback(null, response)
                } catch (err) {
                    callback({
                        code: grpc.status.INTERNAL,
                        message: (err as Error).message,
                    } as grpc.ServiceError, null)
                }
            })()
        },

        heartbeat(call: grpc.ServerDuplexStream<HeartbeatClient, HeartbeatServer>) {
            const md = call.metadata.get('x-cmdhub-node-id')
            const nodeId = md.length > 0 ? String(md[0]) : null
            if (!nodeId) {
                call.emit('error', { code: grpc.status.UNAUTHENTICATED, name: 'unauth', message: 'missing x-cmdhub-node-id' })
                call.end()
                return
            }

            call.on('data', (msg: HeartbeatClient) => {
                void (async () => {
                    await deps.registry.touchLastSeen(nodeId).catch(() => undefined)
                    if (msg.samples?.length) deps.metrics.push(nodeId, msg.samples)
                    call.write({ timestampMs: Date.now(), shutdown: undefined } as HeartbeatServer)
                })()
            })

            call.on('end', () => {
                deps.onNodeDisconnected?.(nodeId)
                call.end()
            })
            call.on('error', () => {
                deps.onNodeDisconnected?.(nodeId)
            })
        },

        createWriteGrant(
            call: grpc.ServerUnaryCall<WriteGrantRequest, ProtoWriteGrant>,
            callback: grpc.sendUnaryData<ProtoWriteGrant>,
        ) {
            void (async () => {
                try {
                    const req = call.request
                    const grant = await deps.fileService.issueWriteGrant({
                        sessionId: req.sessionId || null,
                        nodeId: req.nodeId || null,
                        name: req.name,
                        mime: req.mime,
                        ttlSeconds: req.ttlSeconds,
                        permanent: req.permanent,
                        maxBytes: Number(req.maxBytes),
                    })
                    const proto: ProtoWriteGrant = {
                        grantId: grant.grantId,
                        uploadUrl: grant.uploadUrl,
                        token: grant.token,
                        expiresAtMs: grant.expiresAt,
                        prospectiveHandle: {
                            fileId: grant.prospective.fileId,
                            backend: grant.prospective.backend,
                            size: grant.prospective.size,
                            name: grant.prospective.name,
                            mime: grant.prospective.mime,
                            permanent: grant.prospective.permanent,
                        },
                    }
                    callback(null, proto)
                } catch (err) {
                    callback({
                        code: grpc.status.INTERNAL,
                        message: (err as Error).message,
                    } as grpc.ServiceError, null)
                }
            })()
        },
    }
}
