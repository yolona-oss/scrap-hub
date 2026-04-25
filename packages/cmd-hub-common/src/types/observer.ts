/** Subject-observer pair. `T` is the update payload type. */
export abstract class Subject<T> {
    abstract attach(observer: Observer<T>): void
    abstract detach(observer: Observer<T>): void
    abstract notify(data: T): void
}

export abstract class Observer<T> {
    abstract update(data: T): void
}
