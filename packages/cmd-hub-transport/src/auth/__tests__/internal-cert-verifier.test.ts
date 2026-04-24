import { InternalCertVerifier } from '../internal-cert-verifier'
import * as forge from 'node-forge'

function selfSignedPem(): string {
    const cert = forge.pki.createCertificate()
    const keys = forge.pki.rsa.generateKeyPair(2048)
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = new Date(Date.now() + 86_400_000)
    const attrs = [{ name: 'commonName', value: 'node-1' }]
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.sign(keys.privateKey)
    return forge.pki.certificateToPem(cert)
}

describe('InternalCertVerifier', () => {
    it('computes a SHA-256 fingerprint and matches it against the same cert', async () => {
        const pem = selfSignedPem()
        const v = new InternalCertVerifier()
        const fp = v.fingerprint(pem)
        expect(fp).toMatch(/^[0-9a-f]{64}$/)
        expect(await v.verify({ nodeId: 'node-1', clientCertPem: pem }, fp)).toBe(true)
        expect(await v.verify({ nodeId: 'node-1', clientCertPem: pem }, 'deadbeef')).toBe(false)
    })

    it('returns false for malformed cert input', async () => {
        const v = new InternalCertVerifier()
        expect(await v.verify({ nodeId: 'x', clientCertPem: 'not a cert' }, 'abc')).toBe(false)
    })
})
