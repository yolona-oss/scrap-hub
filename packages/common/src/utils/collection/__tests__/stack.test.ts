import { Stack } from '../stack'

describe('Stack capacity boundary', () => {
    it('accepts exactly `capacity` items, rejects one more', () => {
        const s = new Stack<number>(3)
        s.push(1)
        s.push(2)
        s.push(3)
        expect(s.size()).toBe(3)
        expect(() => s.push(4)).toThrow(/max capacity/)
        expect(s.size()).toBe(3)
    })

    it('multi-item push respects the boundary', () => {
        const s = new Stack<number>(3)
        s.push(1, 2, 3)
        expect(s.size()).toBe(3)
        expect(() => s.push(4)).toThrow(/max capacity/)
    })

    it('multi-item push that would overflow rejects atomically (no partial fill)', () => {
        const s = new Stack<number>(3)
        s.push(1)
        expect(() => s.push(2, 3, 4)).toThrow(/max capacity/)
        expect(s.size()).toBe(1)
    })

    it('default capacity is unbounded', () => {
        const s = new Stack<number>()
        for (let i = 0; i < 10_000; i++) s.push(i)
        expect(s.size()).toBe(10_000)
    })

    it('after pop, room re-opens for push', () => {
        const s = new Stack<number>(3)
        s.push(1, 2, 3)
        s.pop()
        s.push(4)
        expect(s.size()).toBe(3)
        expect(s.peek()).toBe(4)
    })
})
