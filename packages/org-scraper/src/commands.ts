import { BaseUIContext } from "@core/ui"
import { ICmdRegisterManyEntry } from "@core/ui/command-processor"
import { OrgScraperService, SCRAPER_NAME, SCRAPER_DESCRIPTION } from './scraper-service/service'

export function initializeCommands<Ctx extends BaseUIContext>(): ICmdRegisterManyEntry<Ctx> {
    return [
        {
            command: {
                command: SCRAPER_NAME,
                description: SCRAPER_DESCRIPTION,
            },
            invokable: new OrgScraperService()
        }
    ]
}
