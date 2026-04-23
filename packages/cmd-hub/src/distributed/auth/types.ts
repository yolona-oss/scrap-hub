export interface CertVerificationInput {
    nodeId: string
    clientCertPem: string
}

export interface ICertVerifier {
    verify(input: CertVerificationInput, expectedFingerprint: string): Promise<boolean>
    fingerprint(certPem: string): string
}

export interface ITokenVerifier {
    hash(token: string): Promise<string>
    verify(token: string, expectedHash: string): Promise<boolean>
}
