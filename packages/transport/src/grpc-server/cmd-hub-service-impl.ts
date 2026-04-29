import * as grpc from '@grpc/grpc-js'
import { log } from '@cmd-hub/common'
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
import { protoToTree } from '../arg-tree-codec'
import type { FileService } from '../files/file-service'
import type { MetricStore } from '../metrics/metric-store'

const HEARTBEAT_INTERVAL_MS = 15_000

/** Resolves the mTLS client-cert fingerprint from a call. In v1 insecure
 *  tests this reads `x-cmdhub-node-fingerprint` metadata. */
export type FingerprintResolver = (
    call: grpc.ServerUnaryCall<unknown, unknown> | grpc.ServerDuplexStream<unknown, unknown>,
) => string | null

export interface CmdHubServiceDeps {
    registry: CmdNodeRegistry
    aggregator: ManifestAggregator
    fileService: FileService
    metrics: MetricStore
    onNodeRegistered?: (nodeId: string, listenAddress: string) => void
    onNodeDisconnected?: (nodeId: string) => void
    /** Defaults to reading an `x-cmdhub-node-fingerprint` metadata header. */
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
            args: protoToTree(c.args),
            aliases: c.aliases,
            requires: c.requires,
        })),
        services: m.services,
        configs: m.configs.map((c) => ({ name: c.name, scope: c.scope, fields: c.fields })),
        hardware: m.hardware,
        metrics: m.metrics,
        publishedCapabilities: m.publishedCapabilities,
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

                    // `replace: true` swaps any stale prior session in-place
                    // so reconnects emit `onChange` once, not twice.
                    const attach = deps.aggregator.attach(
                        toAggregated(req.manifest),
                        undefined,
                        { replace: true },
                    )
                    if (!attach.ok) {
                        // Bad manifest (semver/compatibilityId/major-version conflict):
                        // disable the node until it's reprovisioned.
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
                    log.info(`CmdHubService: registered node "${req.nodeId}" (state=${state}, listen=${req.listenAddress || '(none)'})`)
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
                log.info(`CmdHubService: heartbeat stream ended for node "${nodeId}"`)
                deps.onNodeDisconnected?.(nodeId)
                call.end()
            })
            call.on('error', (e) => {
                log.warn(`CmdHubService: heartbeat stream errored for node "${nodeId}": ${(e as Error)?.message ?? e}`)
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
