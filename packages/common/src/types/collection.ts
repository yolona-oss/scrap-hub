/** Stack, queue, and linked-list interfaces. Concrete implementations live
 *  in `utils/collection/`. */

export interface IStack<T> {
    push(item: T): void
    pop(): T | undefined
    peek(): T | undefined
    size(): number
}

export interface IQueue<T> {
    enqueue(item: T): void
    dequeue(): T | undefined
    size(): number
}

export class LinkedListNode<T> {
    public next: LinkedListNode<T> | null = null
    public prev: LinkedListNode<T> | null = null
    constructor(public data: T) {}
}

export interface ILinkedList<T> {
    insertInBegin(data: T): LinkedListNode<T>
    insertAtEnd(data: T): LinkedListNode<T>
    deleteNode(node: LinkedListNode<T>): void
    traverse(): T[]
    size(): number
    search(comparator: (data: T) => boolean): LinkedListNode<T> | null
}
