export class Cloner<T> {
    constructor(private value: T) {}

    clone(): T {
        if (typeof this.value === "object" && this.value !== null) {
            return JSON.parse(JSON.stringify(this.value))
        }
        return this.value
    }

    getValue(): T {
        return this.value
    }

    setValue(value: T): void {
        this.value = value
    }
}
