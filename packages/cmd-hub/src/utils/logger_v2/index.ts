import * as fs from 'fs'

import log from '@logger';

// TODO just another logger with binding to determine executor for easy determining of logs and livelog implementation with event emitting
export class Logger {
    constructor(
        public readonly bindingName: string
    ) { }

    public log(message: string) {
        log.info(`${this.bindingName}: ${message}`)
    }

}
