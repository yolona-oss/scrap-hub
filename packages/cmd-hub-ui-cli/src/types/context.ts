import { IManager } from '@cmd-hub/core';
import { BaseUIContext } from '@cmd-hub/core';

export interface CLIContext extends BaseUIContext<IManager & { userId: number|string }> {
    type: 'cli';
    manager: IManager & { userId: number|string }
    userSession: {
        state: string;
        data: Record<string, any>;
    };
    text: string,
    reply(message: string): Promise<void>;
}
