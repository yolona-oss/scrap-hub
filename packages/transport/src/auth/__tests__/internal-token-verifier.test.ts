import { InternalTokenVerifier } from '../internal-token-verifier'

describe('InternalTokenVerifier', () => {
    const v = new InternalTokenVerifier(4) // low rounds to keep tests fast

    it('hash and verify round-trip for the correct token', async () => {
        const h = await v.hash('my-token')
        expect(await v.verify('my-token', h)).toBe(true)
        expect(await v.verify('wrong', h)).toBe(false)
    })
})
