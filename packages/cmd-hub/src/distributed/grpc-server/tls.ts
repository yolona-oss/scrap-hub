import * as grpc from '@grpc/grpc-js'
import * as fs from 'fs'
import type { ServerUnaryCall, ServerDuplexStream } from '@grpc/grpc-js'
import type { FingerprintResolver } from './cmd-hub-service-impl'
import { InternalCertVerifier } from '../auth/internal-cert-verifier'

export interface HubTlsPaths {
    caCertPath: string
    hubCertPath: string
    hubKeyPath: string
}

export function hubServerCredentialsFromPaths(paths: HubTlsPaths): grpc.ServerCredentials {
    const ca = fs.readFileSync(paths.caCertPath)
    const cert = fs.readFileSync(paths.hubCertPath)
    const key = fs.readFileSync(paths.hubKeyPath)
    return grpc.ServerCredentials.createSsl(
        ca,
        [{ cert_chain: cert, private_key: key }],
        true, // require client cert
    )
}

export interface ClientTlsPaths {
    caCertPath: string
    nodeCertPath: string
    nodeKeyPath: string
}

export function nodeChannelCredentialsFromPaths(paths: ClientTlsPaths): grpc.ChannelCredentials {
    const ca = fs.readFileSync(paths.caCertPath)
    const cert = fs.readFileSync(paths.nodeCertPath)
    const key = fs.readFileSync(paths.nodeKeyPath)
    return grpc.credentials.createSsl(ca, key, cert)
}

/**
 * FingerprintResolver that reads the peer certificate from the gRPC call and
 * computes its SHA-256 fingerprint. Use this in production deployments; the
 * insecure default relies on a metadata header instead.
 */
export function mTlsFingerprintResolver(): FingerprintResolver {
    const verifier = new InternalCertVerifier()
    return (call: ServerUnaryCall<unknown, unknown> | ServerDuplexStream<unknown, unknown>) => {
        // grpc-js exposes the peer cert via the call's getPeer() helper only
        // as a string (e.g. "ipv4:1.2.3.4:port"); the actual cert is available
        // from the underlying http2 session. Cast through unknown because the
        // type is not in the public d.ts.
        const session = (call as unknown as {
            call: {
                stream?: {
                    session?: {
                        socket?: {
                            getPeerCertificate?: (detailed: boolean) => unknown
                        }
                    }
                }
            }
        }).call?.stream?.session?.socket
        const getter = session?.getPeerCertificate
        if (!getter) return null
        const certInfo = getter.call(session, true) as { raw?: Buffer } | undefined
        if (!certInfo?.raw) return null
        // Convert DER to PEM so InternalCertVerifier can fingerprint it uniformly.
        const pem = derBufferToPem(certInfo.raw)
        try {
            return verifier.fingerprint(pem)
        } catch {
            return null
        }
    }
}

function derBufferToPem(der: Buffer): string {
    const base64 = der.toString('base64')
    const lines: string[] = []
    for (let i = 0; i < base64.length; i += 64) {
        lines.push(base64.slice(i, i + 64))
    }
    return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----\n`
}
