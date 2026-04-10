import { IManager } from "@core/db";
import { BaseUIContext } from "@core/ui";
import { AvailableUIsEnum } from "@core/ui";

export interface CLIContext extends BaseUIContext {
    type: AvailableUIsEnum.CLI;
    manager: IManager & { userId: number|string }
    userSession: {
        state: string;
        data: Record<string, any>;
    };
    text: string,
    reply(message: string): Promise<void>;
}
