import { isFileHandle, FileHandle, WriteGrant } from '../types'

describe('distributed types', () => {
    it('isFileHandle narrows an opaque value', () => {
        const h: FileHandle = {
            fileId: 'grfs:abc123',
            backend: 'gridfs',
            size: 1234,
            name: 'report.csv',
            mime: 'text/csv',
            permanent: false,
        }
        expect(isFileHandle(h)).toBe(true)
        expect(isFileHandle({ foo: 1 } as unknown)).toBe(false)
        expect(isFileHandle(null)).toBe(false)
        expect(isFileHandle(undefined)).toBe(false)
    })

    it('WriteGrant carries a prospective FileHandle and an expiry', () => {
        const g: WriteGrant = {
            grantId: 'g1',
            uploadUrl: 'http://hub.test/upload?grant=g1',
            token: 't',
            expiresAt: Date.now() + 60_000,
            prospective: {
                fileId: 'grfs:pending',
                backend: 'gridfs',
                size: 0,
                name: 'x.csv',
                mime: 'text/csv',
                permanent: false,
            },
        }
        expect(isFileHandle(g.prospective)).toBe(true)
        expect(g.expiresAt).toBeGreaterThan(Date.now())
    })
})
