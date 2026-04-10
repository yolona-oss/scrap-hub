export class Node<T> {
    public next: Node<T> | null = null
    public prev: Node<T> | null = null
    constructor(public data: T) {}
}

export interface ILinkedList<T> {
    insertInBegin(data: T): Node<T>
    insertAtEnd(data: T): Node<T>
    deleteNode(node: Node<T>): void
    traverse(): T[]
    size(): number
    search(comparator: (data: T) => boolean): Node<T> | null
}
