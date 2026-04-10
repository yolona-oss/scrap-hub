import { ILinkedList, Node } from "@core/types/linked-list";
export { Node, type ILinkedList }

export class LinkedList<T> implements ILinkedList<T> {
    public head: Node<T> | null = null

    public insertInBegin(data: T): Node<T> {
        const node = new Node(data)
        if (!this.head) {
            this.head = node
        } else {
            this.head.prev = node
            node.next = this.head
            this.head = node
        }
        return node
    }

    public insertAtEnd(data: T): Node<T> {
        const node = new Node(data)
        if (!this.head) {
            this.head = node
        } else {
            const getLast = (node: Node<T>): Node<T> => {
                return node.next ? getLast(node.next) : node
            }

            const lastNode = getLast(this.head)
            node.prev = lastNode
            lastNode.next = node
        }
        return node
    }

    public deleteNode(node: Node<T>): void {
        if (!node.prev) {
            this.head = node.next
        } else {
            const prevNode = node.prev
            prevNode.next = node.next
        }
    }

    public traverse(): T[] {
        const array: T[] = []
        if (!this.head) {
            return array
        }

        const addToArray = (node: Node<T>): T[] => {
            array.push(node.data)
            return node.next ? addToArray(node.next) : array
        }
        return addToArray(this.head)
    }

    public size(): number {
        return this.traverse().length
    }

    getLast(cur_head: Node<T>): Node<T> {
        return cur_head.next ? this.getLast(cur_head.next) : cur_head
    }

    public search(comparator: (data: T) => boolean): Node<T> | null {
        const checkNext = (node: Node<T>): Node<T> | null => {
            if (comparator(node.data)) {
                return node
            }
            return node.next ? checkNext(node.next) : null
        }

        return this.head ? checkNext(this.head) : null
    }
}
