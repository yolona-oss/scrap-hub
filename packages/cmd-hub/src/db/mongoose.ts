import mongoose from 'mongoose';

import log from '@logger';
import { timeouted } from '@core/utils/async-tools';

export const MongoConnect = (uri: string, options: any, timeout = 5000): Promise<void> => {
    const conn_promise = new Promise<void>(resolve => {
        log.info("Connecting to mongoose...")
        mongoose.connect(uri, options);
        mongoose.connection.once('open', () => {
            log.info("Mongodb is connected.")
            resolve()
        })
    })
    return timeouted(() => conn_promise, timeout)
};
