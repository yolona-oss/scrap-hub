import log from '../application/logger'

// TODO: another logger with binding for easier per-executor log identification.
export class Logger {
    constructor(
        public readonly bindingName: string,
    ) {}

    public log(message: string): void {
        log.info(`${this.bindingName}: ${message}`)
    }
}
