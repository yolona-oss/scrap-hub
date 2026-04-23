import bcrypt from 'bcryptjs'
import type { ITokenVerifier } from './types'

export class InternalTokenVerifier implements ITokenVerifier {
    constructor(private readonly rounds = 10) {}
    hash(token: string): Promise<string> {
        return bcrypt.hash(token, this.rounds)
    }
    verify(token: string, expectedHash: string): Promise<boolean> {
        return bcrypt.compare(token, expectedHash)
    }
}
