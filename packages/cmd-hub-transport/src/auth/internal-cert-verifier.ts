import { X509Certificate } from 'crypto'
import type { ICertVerifier, CertVerificationInput } from './types'

export class InternalCertVerifier implements ICertVerifier {
    fingerprint(certPem: string): string {
        const x = new X509Certificate(certPem)
        return x.fingerprint256.replace(/:/g, '').toLowerCase()
    }

    async verify(input: CertVerificationInput, expectedFingerprint: string): Promise<boolean> {
        try {
            return this.fingerprint(input.clientCertPem) === expectedFingerprint.toLowerCase()
        } catch {
            return false
        }
    }
}
