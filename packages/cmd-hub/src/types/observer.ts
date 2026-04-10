/** @template T - update data type */
export abstract class Subject<T> {
    abstract attach(observer: Observer<T>): void

    abstract detach(observer: Observer<T>): void

    abstract notify(data: T): void
}

/** @template T - update data type */
export abstract class Observer<T> {
    abstract update(data: T): void
}
