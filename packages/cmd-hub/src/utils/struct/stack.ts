import { IStack } from "@core/types/stack"
export type { IStack }

export class Stack<T> implements IStack<T> {
    private storage: T[] = []

    constructor(private capacity: number = Infinity) {}

    /**
     * @param items The items to add to the stack
     */
    push(...items: T[]): void {
        if (this.size() + items.length >= this.capacity) {
            throw Error("Stack has reached max capacity, you cannot add more items")
        }
        
        this.storage.push(...items)
    }

    /**
     * Pops the last item(s) from the stack
     * @param count The number of items to pop.
     * @returns last poped item
     */
    pop(count = 1): T | undefined {
        let ret = undefined
        for (let i = 0; i < count; i++) {
            ret = this.storage.pop()
        }
        return ret
    }

    /**
    * Returns the last item in the stack
    */
    peek(): T | undefined {
        return this.storage[this.size() - 1]
    }

    /**
    * Returns the number of items in the stack
    */
    size(): number {
        return this.storage.length
    }

    drop(): void {
        this.storage = []
    }

    isEmpty(): boolean {
        return this.size() === 0
    }

    includes(item: T): boolean {
        return this.storage.includes(item)
    }

    reverse(): T[] {
        return this.storage.reverse()
    }
}
