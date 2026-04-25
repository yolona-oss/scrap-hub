import { Phase } from '../phase'

describe('Phase', () => {
    it('defines the five expected phases in ascending order', () => {
        expect(Phase.Infrastructure).toBe(10)
        expect(Phase.Storage).toBe(20)
        expect(Phase.Transport).toBe(30)
        expect(Phase.Services).toBe(40)
        expect(Phase.UI).toBe(50)
    })
})
