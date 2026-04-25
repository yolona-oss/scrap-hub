/** Builder pattern interface — `build()` produces a `T`. */
export interface IBuilder<T> {
    build(): T
}
