import type { CmdArgumentOptionSetter, BranchedPairOptions } from "@cmd-hub/core"

/**
 * Hierarchical builder menu for `aiAgent.*` settings. The first descent
 * picks a sub-key (model / temperature / etc.) and the second descent
 * commits a value (or accepts free-form text input where no leaf list
 * makes sense, e.g. baseUrl/apiKey).
 *
 * Returned values are path-joined by the parser using `PAIR_PATH_DELIMITER`
 * ('/'), so a click on `model → qwen2.5:7b` commits the string
 * `model/qwen2.5:7b`. The scraper service splits at '/' on Execute and
 * persists via `IServiceStore.setField('config.aiAgent.model', leaf)`.
 */
export const aiAgentTreeResolver: CmdArgumentOptionSetter = async (
    _cmd, _disp, _mgr, path = [],
): Promise<string[] | BranchedPairOptions> => {
    if (path.length === 0) {
        return {
            branches: [
                'model',
                'temperature',
                'maxToolCalls',
                'toolTimeoutMs',
                'totalTimeoutMs',
                'baseUrl',
                'apiKey',
            ],
            leaves: [],
        }
    }

    switch (path[0]) {
        case 'model':
            return ['qwen2.5:7b', 'qwen3:8b']
        case 'temperature':
            return ['0.0', '0.2', '0.5', '0.7', '1.0']
        case 'maxToolCalls':
            return ['10', '25', '50', '100']
        case 'toolTimeoutMs':
            return ['30000', '60000', '120000']
        case 'totalTimeoutMs':
            return ['60000', '300000', '600000', '1800000', '3600000']
        // baseUrl / apiKey have no canonical leaf list — return [] so the
        // builder shows just the "Back" aux button and the user types a
        // free-form value as plain text.
        default:
            return []
    }
}

export const googleSheetsTreeResolver: CmdArgumentOptionSetter = async (
    _cmd, _disp, _mgr, path = [],
): Promise<string[] | BranchedPairOptions> => {
    if (path.length === 0) {
        return {
            branches: ['credentials', 'spreadsheetId'],
            leaves: [],
        }
    }
    return []  // both fields are free-form text
}
