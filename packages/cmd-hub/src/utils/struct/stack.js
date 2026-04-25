"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Stack = void 0;
class Stack {
    capacity;
    storage = [];
    constructor(capacity = Infinity) {
        this.capacity = capacity;
    }
    push(...items) {
        if (this.size() + items.length >= this.capacity) {
            throw Error("Stack has reached max capacity, you cannot add more items");
        }
        this.storage.push(...items);
    }
    pop(count = 1) {
        let ret = undefined;
        for (let i = 0; i < count; i++) {
            ret = this.storage.pop();
        }
        return ret;
    }
    peek() {
        return this.storage[this.size() - 1];
    }
    size() {
        return this.storage.length;
    }
    drop() {
        this.storage = [];
    }
    isEmpty() {
        return this.size() === 0;
    }
    includes(item) {
        return this.storage.includes(item);
    }
    reverse() {
        return this.storage.reverse();
    }
}
exports.Stack = Stack;
