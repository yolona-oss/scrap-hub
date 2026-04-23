import * as forge from 'node-forge'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Helpers for the hub's internal CA. v1 only — v2 accepts externally-signed
 * certs via an ICertVerifier replacement (see docs/roadmap.md).
 */

const DEFAULT_VALIDITY_YEARS = 10
const DEFAULT_KEY_BITS = 2048

export interface CAMaterial {
    keyPem: string
    certPem: string
}

export interface NodeCertMaterial {
    keyPem: string
    certPem: string
    /** SHA-256 fingerprint, lowercase hex, no colons — matches InternalCertVerifier. */
    fingerprint: string
}

function attrsFor(commonName: string): forge.pki.CertificateField[] {
    return [{ name: 'commonName', value: commonName }]
}

function addYears(base: Date, years: number): Date {
    const d = new Date(base)
    d.setFullYear(d.getFullYear() + years)
    return d
}

function fingerprint256(certPem: string): string {
    const md = forge.md.sha256.create()
    const asn1 = forge.pki.certificateToAsn1(forge.pki.certificateFromPem(certPem))
    md.update(forge.asn1.toDer(asn1).getBytes())
    return md.digest().toHex()
}

/**
 * Generate a self-signed CA. Call once per deployment; persists its outputs
 * to the paths named by HUB_CA_KEY / HUB_CA_CERT by the caller.
 */
export function createCA(commonName = 'cmd-hub-ca'): CAMaterial {
    const keys = forge.pki.rsa.generateKeyPair(DEFAULT_KEY_BITS)
    const cert = forge.pki.createCertificate()
    cert.publicKey = keys.publicKey
    cert.serialNumber = '01'
    cert.validity.notBefore = new Date()
    cert.validity.notAfter = addYears(cert.validity.notBefore, DEFAULT_VALIDITY_YEARS)
    const attrs = attrsFor(commonName)
    cert.setSubject(attrs)
    cert.setIssuer(attrs)
    cert.setExtensions([
        { name: 'basicConstraints', cA: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true },
    ])
    cert.sign(keys.privateKey, forge.md.sha256.create())

    return {
        keyPem:  forge.pki.privateKeyToPem(keys.privateKey),
        certPem: forge.pki.certificateToPem(cert),
    }
}

/** Sign a node cert with the CA's key. `nodeId` becomes the Common Name. */
export function signNodeCert(
    ca: CAMaterial,
    nodeId: string,
): NodeCertMaterial {
    const caKey  = forge.pki.privateKeyFromPem(ca.keyPem)
    const caCert = forge.pki.certificateFromPem(ca.certPem)

    const nodeKeys = forge.pki.rsa.generateKeyPair(DEFAULT_KEY_BITS)
    const cert = forge.pki.createCertificate()
    cert.publicKey = nodeKeys.publicKey
    // Random-looking serial; uniqueness inside one CA is enough for our purposes.
    cert.serialNumber = Buffer.from(forge.random.getBytesSync(8), 'binary').toString('hex')
    cert.validity.notBefore = new Date()
    cert.validity.notAfter  = addYears(cert.validity.notBefore, DEFAULT_VALIDITY_YEARS)
    cert.setSubject(attrsFor(nodeId))
    cert.setIssuer(caCert.subject.attributes)
    cert.setExtensions([
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', clientAuth: true, serverAuth: true },
    ])
    cert.sign(caKey, forge.md.sha256.create())

    const certPem = forge.pki.certificateToPem(cert)
    return {
        keyPem:  forge.pki.privateKeyToPem(nodeKeys.privateKey),
        certPem,
        fingerprint: fingerprint256(certPem),
    }
}

/** Read CA from disk. */
export function loadCA(keyPath: string, certPath: string): CAMaterial {
    return {
        keyPem:  fs.readFileSync(keyPath, 'utf8'),
        certPem: fs.readFileSync(certPath, 'utf8'),
    }
}

/** Write CA to disk, creating parent dirs as needed. */
export function writeCA(ca: CAMaterial, keyPath: string, certPath: string): void {
    fs.mkdirSync(path.dirname(keyPath), { recursive: true })
    fs.mkdirSync(path.dirname(certPath), { recursive: true })
    fs.writeFileSync(keyPath, ca.keyPem, { mode: 0o600 })
    fs.writeFileSync(certPath, ca.certPem)
}

export { fingerprint256 }
