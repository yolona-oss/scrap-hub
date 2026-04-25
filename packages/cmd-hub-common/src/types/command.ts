/** Command pattern interface — `execute()` runs the command, returning `T`. */
export interface ICommand<T = void> {
    execute(): Promise<T>
}
