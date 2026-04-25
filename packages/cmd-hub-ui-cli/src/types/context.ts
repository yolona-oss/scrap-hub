import type { ManagerRecord } from '@cmd-hub/common'
import { BaseUIContext } from '@cmd-hub/core'

export interface CLIContext extends BaseUIContext<ManagerRecord> {
    type: 'cli';
    manager: ManagerRecord
    userSession: {
        state: string;
        data: Record<string, unknown>;
    };
    text: string,
    reply(message: string): Promise<void>;
}
